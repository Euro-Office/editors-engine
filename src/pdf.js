// sdkjs' PDF editor in the engine (Document::OpenPdf). Runs after engine.js, in the context of a
// blank document of the document editor, whose scripts include the PDF editor (PDFEditorApi).
// sdkjs reads the PDF through core's reader (drawingfile_native.js, the reader x2t uses), and
// its viewer (CHtmlPage), made for a browser page, gets a fixed layout here: its pointer
// handling works in the viewer's pixels. The pages themselves are drawn by the engine with core's
// reader (Document::RenderTile, pageOrigin); sdkjs draws its objects over them: annotations,
// form fields and added pictures, shapes and text boxes. The editor's commands and state are
// those of engine.js' editors (eoEngine), positions in page millimeters.
(function () {

var PT_TO_MM = 25.4 / 72;
// The viewer's zoom: pages are laid out at 96 dpi times this, in whole pixels
var VIEWER_ZOOM = 4;
// Pixels per point of the canvas annotations are drawn on (CPDFGraphics rounds to pixels)
var ANNOTATION_SCALE = 4;

// ---------------------------------------------------------------------------------
// Text of the pages: drawingfile_native.js leaves it out (x2t doesn't need it); text selection,
// markups and search do. Core's reader gives four statistics, then the text commands, in a
// buffer it uses again for the next page: they are copied.
function readPageText() {
	var CFile = window["AscViewer"]["CDrawingFile"];
	CFile.prototype._getGlyphs = function (pageIndex) {
		var data = window["g_native_drawing_file"]["GetGlyphs"](pageIndex);
		if (!data || data.length < 16)
			return { info: [0, 0, 0, 0], result: [] };
		var view = new DataView(data.buffer, data.byteOffset, 16);
		return {
			info: [view.getInt32(0, true), view.getInt32(4, true), view.getInt32(8, true), view.getInt32(12, true)],
			result: data.slice(16)
		};
	};
	CFile.prototype._destroyTextInfo = function () {
		window["g_native_drawing_file"]["DestroyTextInfo"]();
	};
	// The engine opens and closes the file (Document::OpenPdf, ReopenPdf)
	CFile.prototype._closeFile = function () {
		this.nativeFile = 0;
	};
}

// ---------------------------------------------------------------------------------
// A canvas for annotations and form fields (CPDFGraphics draws on a browser canvas): paths are
// collected in canvas pixels and drawn on the engine's graphics in millimeters
function NativeCanvas(graphics, mmPerPixel) {
	this.graphics = graphics;
	this.mmPerPixel = mmPerPixel;
	this.matrix = [1, 0, 0, 1, 0, 0];
	this.stack = [];
	this.path = [];
	this.clips = 0;
	this.fillStyle = "#000000";
	this.strokeStyle = "#000000";
	this.lineWidth = 1;
	this.globalAlpha = 1;
	this.globalCompositeOperation = "source-over";
	this.font = "";
	this.canvas = { width: 0, height: 0 };
}

(function (canvas) {
	var ARC_STEP = Math.PI / 32;

	function parseColor(style) {
		if (typeof style !== "string")
			return { r: 0, g: 0, b: 0, a: 1 };
		var match = style.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
		if (match)
			return { r: +match[1], g: +match[2], b: +match[3], a: match[4] === undefined ? 1 : +match[4] };
		if (style.charAt(0) === "#") {
			var hex = style.length === 4 ? style.replace(/#(.)(.)(.)/, "#$1$1$2$2$3$3") : style;
			return { r: parseInt(hex.substr(1, 2), 16), g: parseInt(hex.substr(3, 2), 16), b: parseInt(hex.substr(5, 2), 16), a: 1 };
		}
		if (style === "transparent")
			return { r: 0, g: 0, b: 0, a: 0 };
		return style === "white" ? { r: 255, g: 255, b: 255, a: 1 } : { r: 0, g: 0, b: 0, a: 1 };
	}

	// A point in canvas pixels to page millimeters, through the current transform
	canvas.point = function (x, y) {
		var m = this.matrix;
		return [(m[0] * x + m[2] * y + m[4]) * this.mmPerPixel, (m[1] * x + m[3] * y + m[5]) * this.mmPerPixel];
	};
	canvas.lastPoint = function () {
		for (var i = this.path.length - 1; i >= 0; --i) {
			if (this.path[i][0] !== "z")
				return this.path[i].slice(-2);
		}
		return [0, 0];
	};
	canvas.save = function () {
		this.stack.push({
			matrix: this.matrix.slice(), clips: this.clips, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle,
			lineWidth: this.lineWidth, globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation
		});
		this.clips = 0;
	};
	canvas.restore = function () {
		for (; this.clips > 0; --this.clips)
			this.graphics.RemoveClipRect();
		var saved = this.stack.pop();
		if (!saved)
			return;
		this.matrix = saved.matrix;
		this.clips = saved.clips;
		this.fillStyle = saved.fillStyle;
		this.strokeStyle = saved.strokeStyle;
		this.lineWidth = saved.lineWidth;
		this.globalAlpha = saved.globalAlpha;
		this.globalCompositeOperation = saved.globalCompositeOperation;
	};
	canvas.setTransform = function (a, b, c, d, e, f) {
		this.matrix = typeof a === "object" ? [a.a, a.b, a.c, a.d, a.e, a.f] : [a, b, c, d, e, f];
	};
	canvas.resetTransform = function () {
		this.matrix = [1, 0, 0, 1, 0, 0];
	};
	canvas.transform = function (a, b, c, d, e, f) {
		var m = this.matrix;
		this.matrix = [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d,
			m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]];
	};
	canvas.translate = function (x, y) { this.transform(1, 0, 0, 1, x, y); };
	canvas.scale = function (x, y) { this.transform(x, 0, 0, y, 0, 0); };
	canvas.rotate = function (angle) {
		var cos = Math.cos(angle), sin = Math.sin(angle);
		this.transform(cos, sin, -sin, cos, 0, 0);
	};
	canvas.beginPath = function () { this.path = []; };
	canvas.moveTo = function (x, y) { this.path.push(["m"].concat(this.point(x, y))); };
	canvas.lineTo = function (x, y) {
		this.path.push([this.path.length ? "l" : "m"].concat(this.point(x, y)));
	};
	canvas.bezierCurveTo = function (x1, y1, x2, y2, x, y) {
		this.path.push(["c"].concat(this.point(x1, y1), this.point(x2, y2), this.point(x, y)));
	};
	canvas.quadraticCurveTo = function (cx, cy, x, y) {
		var p0 = this.lastPoint(), c = this.point(cx, cy), p = this.point(x, y);
		this.path.push(["c", p0[0] + 2 / 3 * (c[0] - p0[0]), p0[1] + 2 / 3 * (c[1] - p0[1]),
			p[0] + 2 / 3 * (c[0] - p[0]), p[1] + 2 / 3 * (c[1] - p[1]), p[0], p[1]]);
	};
	canvas.ellipse = function (x, y, rx, ry, rotation, start, end, counterClockwise) {
		var sweep = end - start;
		if (counterClockwise && sweep > 0)
			sweep -= 2 * Math.PI;
		else if (!counterClockwise && sweep < 0)
			sweep += 2 * Math.PI;
		var steps = Math.max(1, Math.ceil(Math.abs(sweep) / ARC_STEP));
		var cos = Math.cos(rotation || 0), sin = Math.sin(rotation || 0);
		for (var i = 0; i <= steps; ++i) {
			var angle = start + sweep * i / steps;
			var px = rx * Math.cos(angle), py = ry * Math.sin(angle);
			this.lineTo(x + px * cos - py * sin, y + px * sin + py * cos);
		}
	};
	canvas.arc = function (x, y, radius, start, end, counterClockwise) {
		this.ellipse(x, y, radius, radius, 0, start, end, counterClockwise);
	};
	canvas.arcTo = function (x1, y1) { this.lineTo(x1, y1); };
	canvas.rect = function (x, y, w, h) {
		this.moveTo(x, y);
		this.lineTo(x + w, y);
		this.lineTo(x + w, y + h);
		this.lineTo(x, y + h);
		this.closePath();
	};
	canvas.closePath = function () { this.path.push(["z"]); };
	canvas.replay = function () {
		var g = this.graphics;
		g._s();
		this.path.forEach(function (command) {
			switch (command[0]) {
				case "m": g._m(command[1], command[2]); break;
				case "l": g._l(command[1], command[2]); break;
				case "c": g._c(command[1], command[2], command[3], command[4], command[5], command[6]); break;
				case "z": g._z(); break;
			}
		});
	};
	// Highlights multiply with the page in a browser ("multiply"); here they are translucent
	canvas.alpha = function (color) {
		var alpha = color.a * this.globalAlpha;
		if (this.globalCompositeOperation === "multiply")
			alpha = Math.min(alpha, 0.4);
		return Math.round(alpha * 255);
	};
	canvas.fill = function () {
		var color = parseColor(this.fillStyle);
		this.replay();
		this.graphics.b_color1(color.r, color.g, color.b, this.alpha(color));
		this.graphics.df();
	};
	canvas.stroke = function () {
		var color = parseColor(this.strokeStyle);
		var m = this.matrix;
		var scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
		this.replay();
		this.graphics.p_color(color.r, color.g, color.b, this.alpha(color));
		this.graphics.p_width(this.lineWidth * scale * this.mmPerPixel * 1000);
		this.graphics.ds();
	};
	canvas.fillRect = function (x, y, w, h) {
		var path = this.path;
		this.path = [];
		this.rect(x, y, w, h);
		this.fill();
		this.path = path;
	};
	canvas.strokeRect = function (x, y, w, h) {
		var path = this.path;
		this.path = [];
		this.rect(x, y, w, h);
		this.stroke();
		this.path = path;
	};
	canvas.clearRect = function () {};
	// The bounds of the path
	canvas.clip = function () {
		var xs = [], ys = [];
		this.path.forEach(function (command) {
			for (var i = 1; i + 1 < command.length; i += 2) {
				xs.push(command[i]);
				ys.push(command[i + 1]);
			}
		});
		if (!xs.length)
			return;
		var left = Math.min.apply(null, xs), top = Math.min.apply(null, ys);
		this.graphics.AddClipRect(left, top, Math.max.apply(null, xs) - left, Math.max.apply(null, ys) - top);
		++this.clips;
	};
	// Pictures of the document (by their name in the images directory); bitmaps of the page's
	// own drawing (appearance streams) aren't used here
	canvas.drawImage = function (image) {
		var source = image && (image.src || image["src"]);
		if (!source || typeof source !== "string")
			return;
		var args = Array.prototype.slice.call(arguments, 1);
		var dx, dy, dw, dh;
		if (args.length >= 8) {
			dx = args[4]; dy = args[5]; dw = args[6]; dh = args[7];
		} else {
			dx = args[0]; dy = args[1];
			dw = args.length >= 4 ? args[2] : image.width;
			dh = args.length >= 4 ? args[3] : image.height;
		}
		var p1 = this.point(dx, dy), p2 = this.point(dx + dw, dy + dh);
		this.graphics.drawImage(source, Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]),
			Math.abs(p2[0] - p1[0]), Math.abs(p2[1] - p1[1]), Math.round(this.globalAlpha * 255));
	};
	canvas.setLineDash = function () {};
	canvas.getLineDash = function () { return []; };
	canvas.measureText = function () { return { width: 0 }; };
	canvas.fillText = function () {};
	canvas.createImageData = function (w, h) { return { width: w, height: h, data: new Uint8ClampedArray(4 * w * h) }; };
	canvas.getImageData = canvas.createImageData;
	canvas.putImageData = function () {};
	canvas.isPointInPath = function () { return false; };
})(NativeCanvas.prototype);

// ---------------------------------------------------------------------------------

window["eoOpenPdf"] = function () {
	var file = window["eoPdfFile"];
	// The engine's reader of the file (Document::OpenPdf)
	var drawingFile = window["g_native_drawing_file"] = CreateEmbedObject("CDrawingFileEmbed");
	if (drawingFile["GetType"]() === -1) {
		window["eoPdfError"] = -1;
		return;
	}
	readPageText();

	// Objects are numbered as the web editors number them (co-editing names objects by id):
	// from 0 until the user is known, the table of objects first (see engine.js, ID_START), which
	// the new editor numbers again (_onEndLoadSdk), 1
	AscCommon.g_oTableId.Clear();
	AscCommon.g_oIdCounter.Clear();

	// The PDF editor's co-editing, instead of the blank document's (initCollaborativeEditing
	// keeps one that exists)
	AscCommon.CollaborativeEditing = new AscPDF.CPDFCollaborativeEditing();
	// As doctrenderer's NativeCreateApi creates it for "pdf" (docbuilder's native object says "document")
	var api = new window["Asc"]["PDFEditorApi"]({});
	// The editor sdkjs works with, instead of the blank document's
	window["Asc"]["editor"] = window["editor"] = api;
	// Where the open starts numbering: co-editing opens the server's file from here again
	window["eoPdfIdStart"] = AscCommon.g_oIdCounter.m_nIdCounterLoad;
	api["asc_nativeOpenFile"](undefined, undefined);
	stopPainting(api.DocumentRenderer);
	// The engine starts again on the server's file (co-editing, see engine.js' restartEngine)
	window["eoStartEngine"] = function () { pdfEngine(api); };
	pdfEngine(api);
};

// Opens path again in the PDF editor as the first open did (the same ids: the web editor's): a
// new viewer and document on the file
function reopenPdf(api, path) {
	var file = window["eoPdfFile"];
	var counter = AscCommon.g_oIdCounter;
	var userId = counter.m_sUserId;
	var user = api.User;
	var table = AscCommon.g_oTableId;
	var tableId = table.Id;
	table.Clear();
	delete table.m_aPairs[tableId];
	table.Id = tableId;
	table.m_aPairs[tableId] = table;
	counter.Clear();
	counter.m_nIdCounterLoad = window["eoPdfIdStart"];

	api.DocumentRenderer.close();
	api.DocumentRenderer = null;
	file["path"] = path;
	api["asc_nativeOpenFile"](undefined, undefined);
	stopPainting(api.DocumentRenderer);
	counter.Set_Load(false);
	if (userId !== null)
		counter.Set_UserId(userId);
	api.User = user;
	return true;
}

// The viewer paints its canvas on a timer of its own (every 40 ms): the engine draws tiles instead
function stopPainting(viewer) {
	viewer.timer = viewer.timerSync = viewer.timerAnimation = function () {};
	viewer._paint = function () { return false; };
	viewer.isRepaint = false;
}

function pdfEngine(api) {
	var viewer = api.DocumentRenderer;
	var doc = api.getPDFDoc();
	var drawingDocument = api.WordControl.m_oDrawingDocument;
	var native = window["native"];
	var engine = window["eoEngine"] = {};
	// What the app opened: sdkjs' PDF editor (EditorDocument.isPdf)
	engine["kind"] = "pdf";

	var resources = {
		"isResourcesObject": true,
		"fontsDirectory": native["GetFontsDirectory"](),
		"imagesDirectory": native["GetImagesPath"]()
	};

	// ---------------------------------------------------------------------------------
	// The viewer: a fixed layout, all pages "visible", painting replaced (the engine draws
	// tiles; the pages sdkjs would paint again are reported as dirty)

	var state = {
		"cursor": null, "selection": [], "drawings": [], "dirtyPages": {}, "layoutChanged": false,
		"layoutPending": false, "currentPage": -1, "modified": false, "error": null, "interface": {}
	};

	function layout() {
		viewer.zoom = VIEWER_ZOOM;
		viewer.offsetTop = 0;
		viewer.recalculatePlaces();
		viewer.width = viewer.documentWidth;
		viewer.height = viewer.documentHeight;
		viewer.scrollX = viewer.scrollY = 0;
		viewer.x = viewer.y = 0;
		viewer.startVisiblePage = 0;
		viewer.endVisiblePage = viewer.file.pages.length - 1;
		viewer.updatePageDetector();
		doc.UpdatePagesTransform();
		viewer.currentPage = Math.min(viewer.currentPage || 0, viewer.file.pages.length - 1);
		state["layoutChanged"] = true;
	}

	stopPainting(viewer);
	viewer.paint = function (onRepaint, onAfterPaint) {
		if (onRepaint)
			onRepaint();
		if (onAfterPaint)
			onAfterPaint();
	};
	viewer.onUpdateOverlay = function () {};
	viewer.onUpdatePages = function () { allPagesChanged(); };
	viewer.setCursorType = function () {};
	viewer.showTextMessage = function () {};
	viewer.checkVisiblePages = function () {};
	viewer.resize = function () { layout(); };
	viewer.scrollToXY = function () {};
	// Places in the file the app shows (links, the contents)
	viewer.navigateToPage = function (page, y) {
		state["navigate"] = { "page": page, "y": (y || 0) * PT_TO_MM };
	};
	// Input waits for a repaint in a browser; here pages are drawn when the app asks
	viewer.canInteract = function () { return false !== api.canInteract; };
	// The current search match, shown as the selection (the viewer scrolls to it)
	var searchMatch = [];
	viewer.ToSearchResult = function () {
		searchMatch = (viewer.CurrentSearchNavi || []).map(function (navi) {
			var points = [];
			[[navi.X, navi.Y], [navi.X + navi.W, navi.Y], [navi.X + navi.W, navi.Y + navi.H], [navi.X, navi.Y + navi.H]].forEach(function (corner) {
				var transform = navi.Transform;
				points.push(transform ? transform.TransformPointX(corner[0], corner[1]) : corner[0],
					transform ? transform.TransformPointY(corner[0], corner[1]) : corner[1]);
			});
			return { "page": navi.PageNum, "points": points };
		});
	};
	viewer.thumbnails = null;
	viewer.MouseHandObject = null;
	viewer.initPaintDone = true;
	drawingDocument.CanvasHitContext = createHitContext();
	AscCommon.CNativeGraphics.prototype.RemoveLastClip = function () { this.RemoveClipRect(); };
	layout();

	function allPagesChanged() {
		for (var i = 0; i < viewer.file.pages.length; ++i)
			state["dirtyPages"][i] = true;
	}

	// Pages sdkjs would paint again
	function collectDirtyPages() {
		viewer.pagesInfo.pages.forEach(function (info, index) {
			if (info.needRedrawAnnots || info.needRedrawForms || info.needRedrawDrawings || info.needRedrawMarkups) {
				state["dirtyPages"][index] = true;
				info.needRedrawAnnots = info.needRedrawForms = info.needRedrawDrawings = info.needRedrawMarkups = false;
			}
		});
	}

	// Page millimeters (as drawn, rotated) to the viewer's pixels and back
	function pixelsPerMm() {
		return 96 * VIEWER_ZOOM / 25.4;
	}
	function pageOrigin(page) {
		var drawingPage = viewer.drawingPages[page];
		var landscape = viewer.isLandscapePage(page);
		var width = landscape ? drawingPage.H : drawingPage.W;
		return [(viewer.width >> 1) - (width >> 1), drawingPage.Y - viewer.scrollY];
	}
	function toViewer(page, x, y) {
		var origin = pageOrigin(page);
		return [origin[0] + x * pixelsPerMm(), origin[1] + y * pixelsPerMm()];
	}
	// A point of a page in points (as in the file) to page millimeters as drawn
	function fromPage(page, x, y) {
		var invert = doc.pagesTransform[page].invert;
		var origin = pageOrigin(page);
		return [(invert.TransformPointX(x, y) - origin[0]) / pixelsPerMm(), (invert.TransformPointY(x, y) - origin[1]) / pixelsPerMm()];
	}

	function pageSize(page) {
		var info = viewer.file.pages[page];
		var width = info.W * 25.4 / info.Dpi, height = info.H * 25.4 / info.Dpi;
		return viewer.getPageRotate(page) & 1 ? [height, width] : [width, height];
	}

	// ---------------------------------------------------------------------------------
	// Pages and tiles

	engine["getPageCount"] = function () { return viewer.file.pages.length; };
	engine["getPageWidth"] = function (page) { return pageSize(page)[0]; };
	engine["getPageHeight"] = function (page) { return pageSize(page)[1]; };
	// The page in the file the engine draws under sdkjs' objects: -1 for a page added in the
	// editor or one whose text was made editable (sdkjs draws its content)
	// The page the app shows: searching starts there, text boxes go there
	engine["setCurrentPage"] = function (page) {
		if (page >= 0 && page < viewer.file.pages.length)
			viewer.currentPage = page;
	};
	engine["pageOrigin"] = function (page) {
		var info = viewer.file.pages[page];
		return !info || info.originIndex === undefined || info.isRecognized ? -1 : info.originIndex;
	};

	engine["tile"] = null;
	engine["beginTile"] = function () {
		engine["tile"] = new AscCommon.CNativeGraphics();
	};

	// Draws sdkjs' objects over the area (x, y, width, height) of the page rendered at
	// pageWidth x pageHeight pixels, as CHtmlPage.GetPrintPage does
	engine["drawTile"] = function (page, pageWidth, pageHeight, x, y, width, height) {
		var size = pageSize(page);
		var mmPerPixelX = size[0] / pageWidth;
		var mmPerPixelY = size[1] / pageHeight;
		var g = engine["tile"];
		g.width = width;
		g.height = height;
		g.create(resources, width, height, width * mmPerPixelX, height * mmPerPixelY);
		g.CoordTransformOffset(-x, -y);
		g.transform(1, 0, 0, 1, 0, 0);
		g.setEndGlobalAlphaColor(255, 255, 255);
		// Some objects keep their size on screen (1 / zoom: the icons of notes): their size at 100 %
		viewer.zoom = 1;
		try {
			drawObjects(page, g);
		} finally {
			viewer.zoom = VIEWER_ZOOM;
			g.Native["Destroy"]();
			engine["tile"] = null;
		}
	};

	function drawObjects(page, g) {
		var info = viewer.pagesInfo.pages[page];
		if (!info)
			return;
		var file = viewer.file;
		var widthPt = file.getPageWidth(page), heightPt = file.getPageHeight(page);
		var pdfGraphics = new AscPDF.CPDFGraphics();
		pdfGraphics.Init(new NativeCanvas(g, PT_TO_MM / ANNOTATION_SCALE), widthPt * ANNOTATION_SCALE, heightPt * ANNOTATION_SCALE, widthPt, heightPt);
		pdfGraphics.SetCurPage(page);
		function each(list, draw) {
			(list || []).forEach(function (item) {
				try {
					draw(item);
				} catch (e) {
					console.log("pdf: drawing " + e + "\n" + e.stack);
				}
			});
		}
		each(info.drawings, function (drawing) { drawing.Draw(g); });
		// Annotations from their properties (in a browser the unchanged ones are pictures of
		// their appearance streams)
		each(info.annots, function (annot) {
			if (annot.IsTextMarkup())
				annot.Draw(pdfGraphics);
		});
		each(info.annots, function (annot) {
			if (!annot.IsTextMarkup() && !annot.IsHidden())
				annot.Draw(pdfGraphics, g);
		});
		each(info.fields, function (field) { field.DrawOnPage(pdfGraphics, g, page); });
	}

	// ---------------------------------------------------------------------------------
	// State

	var cursorVisible = false;
	var cursorPosition = null;
	function updateCursor() {
		if (!cursorVisible || !cursorPosition) {
			state["cursor"] = null;
			return;
		}
		var height = drawingDocument.m_dTargetSize;
		var matrix = drawingDocument.TextMatrix;
		function point(px, py) {
			return matrix ? [matrix.TransformPointX(px, py), matrix.TransformPointY(px, py)] : [px, py];
		}
		var top = point(cursorPosition.x, cursorPosition.y);
		var bottom = point(cursorPosition.x, cursorPosition.y + height);
		state["cursor"] = { "page": cursorPosition.page, "x1": top[0], "y1": top[1], "x2": bottom[0], "y2": bottom[1] };
	}
	function wrap(name, after) {
		var original = drawingDocument[name];
		if (!original)
			return;
		drawingDocument[name] = function () {
			var result = original.apply(this, arguments);
			after.apply(null, arguments);
			return result;
		};
	}
	wrap("UpdateTarget", function (x, y, page) {
		cursorPosition = { x: x, y: y, page: page };
		updateCursor();
	});
	wrap("SetTargetSize", updateCursor);
	wrap("UpdateTargetTransform", updateCursor);
	// Shown: TargetShow (as in the document editor), TargetStart (the PDF editor's)
	["TargetShow", "TargetStart"].forEach(function (name) {
		wrap(name, function () {
			cursorVisible = true;
			updateCursor();
		});
	});
	wrap("TargetEnd", function () {
		cursorVisible = false;
		updateCursor();
	});

	// Selected text of the file: quads in points (left top, right top, left bottom, right bottom)
	function textSelection() {
		if (doc.activeDrawing || !viewer.file.isSelectionUse())
			return [];
		var areas = [];
		viewer.file.getSelectionQuads().forEach(function (pageQuads) {
			pageQuads.quads.forEach(function (quad) {
				var points = [];
				[[quad[0], quad[1]], [quad[2], quad[3]], [quad[6], quad[7]], [quad[4], quad[5]]].forEach(function (corner) {
					points = points.concat(fromPage(pageQuads.page, corner[0], corner[1]));
				});
				areas.push({ "page": pageQuads.page, "points": points });
			});
		});
		return areas;
	}

	// Text selected in a text box, a free text annotation or a field: drawn by sdkjs as rectangles
	var editSelection = [];
	var selectionPage = 0;
	drawingDocument["AddPageSelection"] = function (page, x, y, w, h) {
		var matrix = drawingDocument.TextMatrix;
		var points = [];
		[[x, y], [x + w, y], [x + w, y + h], [x, y + h]].forEach(function (corner) {
			points.push(matrix ? matrix.TransformPointX(corner[0], corner[1]) : corner[0],
				matrix ? matrix.TransformPointY(corner[0], corner[1]) : corner[1]);
		});
		editSelection.push({ "page": typeof page === "number" ? page : selectionPage, "points": points });
	};
	function textBoxSelection() {
		editSelection = [];
		var object = doc.GetActiveObject && doc.GetActiveObject();
		var content = object && object.GetDocContent && object.GetDocContent();
		if (!content || !content.IsSelectionUse() || content.IsSelectionEmpty())
			return [];
		selectionPage = object.GetPage();
		var textMatrix = drawingDocument.TextMatrix;
		try {
			if (object.IsDrawing && object.IsDrawing())
				doc.GetController().drawTextSelection(selectionPage);
			else
				content.DrawSelectionOnPage(0);
		} catch (e) {
			console.log("pdf: selection " + e);
		}
		drawingDocument.TextMatrix = textMatrix;
		return editSelection;
	}

	function selectedDrawings() {
		var controller = doc.GetController();
		if (!controller || controller.getTargetDocContent())
			return [];
		return controller.getSelectedArray().map(function (drawing) {
			// Laid out when drawn in a browser; their frames are needed now
			if (drawing.IsNeedRecalc && drawing.IsNeedRecalc())
				drawing.Recalculate();
			return { drawing: drawing, page: drawing.GetPage ? drawing.GetPage() : 0 };
		});
	}

	// Frames of the selected objects: shapes (pictures, shape annotations) as in the other
	// editors; other annotations (notes, markups) by their rectangle, without handles
	function drawingFrames() {
		var selected = selectedDrawings();
		var shapes = selected.filter(function (item) { return item.drawing.transform; });
		var frames = drawingStates(shapes, doc.GetController());
		selected.forEach(function (item) {
			if (item.drawing.transform || !item.drawing.GetRect)
				return;
			var rect = item.drawing.GetRect();
			var points = [];
			[[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]].forEach(function (corner) {
				points = points.concat(fromPage(item.page, corner[0], corner[1]));
			});
			frames.push({ "page": item.page, "points": points, "canMove": true, "canResize": false });
		});
		return frames;
	}

	["asc_onCanUndo", "asc_onCanRedo", "asc_onDocumentModifiedChanged"].forEach(function (name) {
		api.asc_registerCallback(name, function (value) {
			state["interface"][name.substring("asc_on".length)] = value;
		});
	});
	api.asc_registerCallback("asc_onHyperlinkClick", function (url) {
		state["openUrl"] = url;
	});

	engine["reportError"] = function (e) {
		state["error"] = String(e) + (e && e.stack ? "\n" + e.stack : "");
	};

	engine["getState"] = function () {
		// The cursor, as the viewer places it when it paints (see stopPainting), in text laid
		// out as when it is drawn
		var textController = doc.getTextController();
		if (textController && textController.IsNeedRecalc && textController.IsNeedRecalc() && textController.Recalculate)
			textController.Recalculate();
		viewer._checkTargetUpdate();
		collectDirtyPages();
		state["selection"] = textSelection().concat(textBoxSelection(), search ? searchMatch : []);
		state["drawings"] = drawingFrames();
		state["modified"] = api.isDocumentModified();
		state["interface"]["CanUndo"] = doc.History.Can_Undo();
		state["interface"]["CanRedo"] = doc.History.Can_Redo();
		state["layoutPending"] = false;
		state["currentPage"] = -1;
		state["pdf"] = pdfState();
		state["coEditing"] = engine["coEditingState"] ? engine["coEditingState"]() : null;
		var result = JSON.stringify(state);
		state["dirtyPages"] = {};
		state["layoutChanged"] = false;
		state["error"] = null;
		state["openUrl"] = null;
		state["navigate"] = null;
		return result;
	};

	// The PDF editor's own part of the state: the tool, what is selected
	function pdfState() {
		var annot = doc.mouseDownAnnot;
		return {
			"ink": api.isInkDrawerOn(),
			"annotation": annot ? { "id": annot.GetId(), "type": annot.GetType(), "comment": !!annot.GetContents() } : null,
			"textSelected": viewer.file.isSelectionUse() && !doc.activeDrawing
		};
	}

	engine["tick"] = runTimers;

	// ---------------------------------------------------------------------------------
	// Input, as CHtmlPage's mouse handlers pass it on (without the browser parts)

	// The text of a page, which the viewer reads for the pages it paints
	function loadText(page) {
		var info = viewer.file.pages[page];
		if (info && info.text === null && info.originIndex !== undefined)
			info.text = viewer.file.getText(info.originIndex);
	}

	var lastPoint = { page: 0, x: 10, y: 10 };
	engine["mouse"] = function (type, page, x, y, clickCount, addToSelection, extend) {
		loadText(page);
		var p = toViewer(page, x, y);
		var e = mouseEvent(type, clickCount, addToSelection, extend);
		var global = AscCommon.global_mouseEvent;
		global.X = e.X = p[0];
		global.Y = e.Y = p[1];
		lastPoint = { page: page, x: x, y: y };
		if (type === 0) {
			viewer.isMouseDown = true;
			viewer.mouseDownCoords.X = p[0];
			viewer.mouseDownCoords.Y = p[1];
			doc.OnMouseDown(p[0], p[1], global);
			// A long press (the app sends it as a double click) selects the word at once, as in
			// the document editor: the selection is there before the finger is lifted
			if (clickCount === 2 && viewer.canSelectPageText() && !doc.mouseDownAnnot && !doc.mouseDownField) {
				var word = viewer.getPageByCoords2(p[0], p[1]);
				if (word)
					viewer.file.selectWholeWord(word.index, word.x, word.y);
			}
		} else if (type === 1) {
			if (viewer.isMouseDown && viewer.canSelectPageText()) {
				var position = viewer.getPageByCoords2(p[0], p[1]);
				if (position)
					viewer.file.onMouseMove(position.index, position.x, position.y);
			} else {
				doc.OnMouseMove(p[0], p[1], global);
			}
		} else {
			var wasDown = viewer.isMouseDown;
			viewer.isMouseDown = false;
			doc.OnMouseUp(p[0], p[1], global);
			// A double click (or a long press, which the app sends as one) selects a word, unless
			// the selection was dragged
			var moved = Math.abs(p[0] - viewer.mouseDownCoords.X) + Math.abs(p[1] - viewer.mouseDownCoords.Y) > 2;
			if (viewer.canSelectPageText() && !doc.mouseDownAnnot && !doc.mouseDownField && !moved) {
				var start = viewer.getPageByCoords2(viewer.mouseDownCoords.X, viewer.mouseDownCoords.Y);
				if (start && clickCount === 2) {
					viewer.file.selectWholeWord(start.index, start.x, start.y);
					return;
				}
				if (start && clickCount === 3) {
					viewer.file.selectWholeRow(start.index, start.x, start.y);
					return;
				}
			}
			if (wasDown && !doc.GetActiveObject()) {
				var end = viewer.getPageByCoords2(p[0], p[1]);
				if (end)
					viewer.file.onMouseUp(end.index, end.x, end.y);
			}
		}
	};

	// Selects text from the start to the end point (selection handles)
	engine["select"] = function (startPage, startX, startY, endPage, endX, endY) {
		viewer.file.removeSelection();
		engine["mouse"](0, startPage, startX, startY, 1, false, false);
		engine["mouse"](1, endPage, endX, endY, 1, false, false);
		engine["mouse"](2, endPage, endX, endY, 1, false, false);
	};

	engine["keyDown"] = function (keyCode, shift, ctrl) {
		var e = new AscCommon.CKeyboardEvent();
		e.KeyCode = keyCode;
		e.ShiftKey = shift;
		e.CtrlKey = ctrl;
		doc.OnKeyDown(e);
	};

	function codePoints(text) {
		var codes = [];
		for (var i = 0; i < text.length; ++i) {
			var code = text.codePointAt(i);
			codes.push(code);
			if (code > 0xFFFF)
				++i;
		}
		return codes;
	}
	engine["enterText"] = function (text) { api.asc_enterText(codePoints(String(text))); };
	engine["commitText"] = engine["enterText"];
	// Typing goes in at once (fields and text boxes are short)
	engine["setComposingText"] = function () {};
	engine["finishComposingText"] = function () {};

	engine["selectAll"] = function () { api.asc_EditSelectAll(); };
	engine["copy"] = function () {
		var text = api.asc_GetSelectedText ? api.asc_GetSelectedText(true) : "";
		return JSON.stringify({ "text": text || "", "internal": "" });
	};
	engine["cut"] = engine["copy"];
	engine["paste"] = function (text) { if (text) engine["enterText"](text); };

	engine["undo"] = function () { api.Undo(); allPagesChanged(); };
	engine["redo"] = function () { api.Redo(); allPagesChanged(); };
	engine["deleteSelection"] = function () { api.asc_remove(); };

	// ---------------------------------------------------------------------------------
	// Annotations

	function rgb(hex) {
		return [parseInt(hex.substring(0, 2), 16), parseInt(hex.substring(2, 4), 16), parseInt(hex.substring(4, 6), 16)];
	}
	// Marks up the selected text: kind "highlight", "underline" or "strikeout", color "RRGGBB"
	engine["markup"] = function (kind, hex) {
		var types = { "highlight": AscPDF.ANNOTATIONS_TYPES.Highlight, "underline": AscPDF.ANNOTATIONS_TYPES.Underline,
			"strikeout": AscPDF.ANNOTATIONS_TYPES.Strikeout };
		var color = rgb(hex);
		api.SetMarkerFormat(types[kind], true, 100, color[0], color[1], color[2]);
		api.SetMarkerFormat(undefined, false);
	};
	// Freehand drawing with a pen ("RRGGBB", width in mm, opacity 0-1, opaque by default) until stopInk
	engine["startInk"] = function (hex, width, opacity) {
		var stroke = new Asc.asc_CStroke();
		stroke.asc_putType(Asc.c_oAscStrokeType.STROKE_COLOR);
		stroke.asc_putColor(rgbColor(hex));
		stroke.asc_putWidth(width);
		// sdkjs takes a pen without it as invisible
		stroke.asc_putTransparent(Math.round(255 * (opacity === undefined ? 1 : opacity)));
		api.asc_StartDrawInk(stroke);
	};
	engine["stopInk"] = function () { api.asc_StopInkDrawer(); };
	// A text box on the page (free text annotation), at the last touch
	engine["addFreeText"] = function () {
		api.AddFreeTextAnnot(AscPDF.FREE_TEXT_INTENT_TYPE ? AscPDF.FREE_TEXT_INTENT_TYPE.FreeText : 0);
	};

	// Comments: notes on the page and the comments of annotations,
	// [{id, text, user, time, quote, solved, replies, page, x, y}]
	var commentUser = { "id": "", "name": "" };
	engine["setCommentUser"] = function (id, name) { commentUser = { "id": id, "name": name }; };
	function commentAnnot(id) {
		return doc.annots.filter(function (annot) { return annot.GetId() === id; })[0] || null;
	}
	engine["getComments"] = function () {
		var result = [];
		doc.annots.forEach(function (annot) {
			var data = annot.GetAscCommentData && annot.GetAscCommentData();
			if (!data)
				return;
			var rect = annot.GetRect();
			var place = fromPage(annot.GetPage(), rect[0], rect[1]);
			result.push(commentJson(annot.GetId(), data, { "page": annot.GetPage(), "x": place[0], "y": place[1] }));
		});
		return JSON.stringify(result);
	};
	function newComment(text) {
		var data = newCommentData(Asc.asc_CCommentDataWord, commentUser, text);
		data.asc_putOnlyOfficeTime(String(Date.now()));
		return data;
	}
	// On the selected annotation, or a note where the page was last touched
	engine["addComment"] = function (text) {
		var p = toViewer(lastPoint.page, lastPoint.x, lastPoint.y);
		AscCommon.global_mouseEvent.X = p[0];
		AscCommon.global_mouseEvent.Y = p[1];
		if (!doc.mouseDownAnnot)
			doc.anchorPositionToAdd = { x: lastPoint.x / PT_TO_MM, y: lastPoint.y / PT_TO_MM };
		api.asc_addComment(newComment(text));
	};
	function changeComment(id, change) {
		var annot = commentAnnot(id);
		var data = annot && annot.GetAscCommentData();
		if (!data)
			return;
		change(data);
		api.asc_changeComment(id, data);
	}
	engine["replyComment"] = function (id, text) {
		changeComment(id, function (data) { data.asc_addReply(newComment(text)); });
	};
	engine["resolveComment"] = function (id, solved) {
		changeComment(id, function (data) { data.asc_putSolved(solved); });
	};
	engine["deleteComment"] = function (id) { api.asc_removeComment(id); };
	engine["gotoComment"] = function (id) {
		var annot = commentAnnot(id);
		if (annot) {
			var rect = annot.GetRect();
			viewer.navigateToPage(annot.GetPage(), rect[1]);
		}
	};

	// A picture from the images directory (name, size in pixels) on the page at (x, y) with
	// the size (width, height) in mm: a drawn signature
	engine["placeImage"] = function (name, widthPx, heightPx, page, x, y, width, height) {
		preloadImage(api, name, widthPx, heightPx);
		viewer.currentPage = page;
		// sdkjs places it in the middle of the page, at its size there
		var computePosition = doc.private_computeDrawingAddingPos;
		var pixelsToMm = AscCommon.g_dKoef_pix_to_mm;
		doc.private_computeDrawingAddingPos = function () { return { x: x, y: y }; };
		api.ImageLoader.map_image_index[name].Image = { "width": width / pixelsToMm, "height": height / pixelsToMm };
		try {
			api.AddImageUrlAction(name);
		} finally {
			doc.private_computeDrawingAddingPos = computePosition;
			api.ImageLoader.map_image_index[name].Image = { "width": widthPx, "height": heightPx };
		}
		state["dirtyPages"][page] = true;
	};

	// ---------------------------------------------------------------------------------
	// Contents, links, text

	// The file's contents (bookmarks): [{index, text, level}]
	var outline = [];
	engine["getOutline"] = function () {
		outline = [];
		var structure = viewer.file.getStructure() || [];
		structure.forEach(function (item) {
			outline.push({ page: item["page"], y: item["y"], text: item["description"], level: (item["level"] || 0) + 1 });
		});
		return JSON.stringify(outline.map(function (item, index) {
			return { "index": index, "text": item.text || "", "level": item.level };
		}));
	};
	engine["gotoOutline"] = function (index) {
		var item = outline[index];
		if (item)
			viewer.navigateToPage(item.page, item.y);
	};

	// The same as places: [{title, level, page, y}] (y in mm from the page's top)
	engine["getFileOutline"] = function () {
		return JSON.stringify((viewer.file.getStructure() || []).map(function (item) {
			return { "title": item["description"] || "", "level": (item["level"] || 0) + 1, "page": item["page"] || 0, "y": (item["y"] || 0) * PT_TO_MM };
		}));
	};

	// Links are followed when tapped (sdkjs): web addresses come in the state (openUrl), places
	// in the file too (navigate)
	engine["followLink"] = function () {};

	// Search in the text of all pages; the current match is selected
	var search = null;
	// The viewer searches once it has the text of all pages (its painting reads it)
	function loadAllText() {
		for (var i = 0; i < viewer.file.pages.length; ++i)
			loadText(i);
		viewer.pagesInfo.countTextPages = viewer.file.pages.length;
		viewer.isFullText = true;
	}
	engine["find"] = function (text, matchCase, wholeWords, forward) {
		loadAllText();
		var settings = new AscCommon.CSearchSettings();
		settings.SetText(text);
		settings.SetMatchCase(matchCase);
		settings.SetWholeWords(wholeWords);
		search = { "count": api.asc_findText(settings, forward) || 0, "current": -1, "replaced": -1 };
		var searchEngine = doc.SearchEngine;
		if (search["count"] && searchEngine.GetElementIndexById)
			search["current"] = searchEngine.GetElementIndexById(searchEngine.CurId);
		state["search"] = search;
	};
	engine["replace"] = function () {};
	engine["endFind"] = function () {
		api.asc_endFindText();
		searchMatch = [];
		search = null;
		state["search"] = null;
	};

	// Lines of text of a page, for screen readers: [{text, left, top, right, bottom}]
	engine["textBlocks"] = function (page) {
		return "[]";
	};

	// ---------------------------------------------------------------------------------
	// Saving (Document::SavePdf): sdkjs' changes as edit commands, which core applies to the file

	engine["beforeSave"] = function () {};
	engine["savePdf"] = function () {
		// A copy: Save's array is a view on a larger buffer, which the engine reads from its start
		var commands = viewer.Save();
		return commands ? new Uint8Array(commands) : null;
	};
	engine["afterSave"] = function (success) {
		if (success)
			doc.History.Reset_SavedIndex();
	};
	engine["getImagesDirectory"] = function () { return native["GetImagesPath"](); };

	// What the document editors have and PDFs don't
	["setTranslations", "setSpellLanguages", "setSpellCheck", "spellResults"].forEach(function (name) {
		engine[name] = function () {};
	});
	engine["takeSpellRequests"] = function () { return "[]"; };

	// ---------------------------------------------------------------------------------
	// Co-editing (engine.js' coEditingCommands): the server's file is opened again, as the first
	// open did, and the session's changes are applied as in the web editor; the engine starts
	// again on it (eoStartEngine)

	coEditingCommands(engine, api, allPagesChanged, true);
	var co = window["eoCoState"];
	// Nothing is laid out here (engine.js' restart leaves the document editor's silent mode)
	api.asc_SetSilentMode = function () {};
	// The engine opens the server's file after this command (Document::ReopenPdf), then
	// pdfReopened continues
	api._onOpenCommand = function (url) {
		var path = co.files[url];
		if (!path) {
			api.sendEvent("asc_onError", Asc.c_oAscError.ID.DownloadError, Asc.c_oAscError.Level.Critical);
			return;
		}
		window["eoPdfReopen"] = path;
	};
	engine["pdfReopened"] = function (path) {
		if (!path || !reopenPdf(api, path)) {
			api.sendEvent("asc_onError", Asc.c_oAscError.ID.DownloadError, Asc.c_oAscError.Level.Critical);
			return;
		}
		co.sendChangesToServer();
		co.loading = true;
		api.isDocumentLoadComplete = false;
		api.ServerImagesWaitComplete = true;
		api.isApplyChangesOnOpenEnabled = true;
		api.DocumentRenderer.isDocumentContentReady = true;
		api._openDocumentEndCallback();
	};

	// Start: the interface state, all pages to draw
	if (!co.loading)
		api.isDocumentLoadComplete = true;
	allPagesChanged();
}

window["eoOpenPdf"]();
})();
