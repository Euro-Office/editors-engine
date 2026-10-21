// sdkjs side of the engine, run once after a document is opened (see Document::Open).
// Leaves docbuilder's builder mode, lays out the document (text documents: the first pages
// now, the others in slices, see tick) and draws tiles into graphics objects whose memory
// the native engine provides. Works for text documents and presentations: "pages" are the
// slides of a presentation (see the editor adapters below).
// Timers. sdkjs continues long work on timers, like the web editor's layout of the pages after
// the first ones; native.js ignores them. Here they wait in a queue the app runs in slices
// (eoEngine.tick), between its commands.
var timers = [];
var nextTimerId = 1;

window["setTimeout"] = function (callback) {
	if (typeof callback !== "function")
		return 0;
	var timer = { id: nextTimerId++, callback: callback, args: Array.prototype.slice.call(arguments, 2) };
	timers.push(timer);
	return timer.id;
};

window["clearTimeout"] = function (id) {
	for (var i = 0; i < timers.length; ++i) {
		if (timers[i].id === id) {
			timers.splice(i, 1);
			return;
		}
	}
};

// Runs the timers queued so far (not those they queue) for up to budget milliseconds
function runTimers(budget) {
	var end = Date.now() + budget;
	for (var count = timers.length; count > 0 && timers.length > 0 && Date.now() < end; --count) {
		var timer = timers.shift();
		try {
			timer.callback.apply(window, timer.args);
		} catch (e) {
			console.log("timer: " + e + "\n" + e.stack);
		}
	}
}

// Corners of a drawing's frame on the page, clockwise from the top left
function drawingFrame(matrix, extX, extY) {
	var points = [];
	[[0, 0], [extX, 0], [extX, extY], [0, extY]].forEach(function (corner) {
		points.push(matrix.TransformPointX(corner[0], corner[1]), matrix.TransformPointY(corner[0], corner[1]));
	});
	return points;
}

// The state's "drawings": frames of the selected pictures and shapes ([{drawing, page}]) with
// their rotation handle, or while they are moved, resized or rotated (controller's track
// objects), where they would go
function drawingStates(selected, controller) {
	var page = selected.length ? selected[0].page : -1;
	var tracks = controller && controller.arrTrackObjects || [];
	if (tracks.length && page >= 0) {
		return tracks.map(function (track) {
			var source = track.originalObject || {};
			var extX = track.resizedExtX !== undefined ? track.resizedExtX : source.extX;
			var extY = track.resizedExtY !== undefined ? track.resizedExtY : source.extY;
			return { "page": typeof track.pageIndex === "number" ? track.pageIndex : page, "points": drawingFrame(track.transform, extX, extY), "tracking": true };
		});
	}
	return selected.map(function (item) {
		var drawing = item.drawing;
		var result = { "page": item.page, "points": drawingFrame(drawing.transform, drawing.extX, drawing.extY),
			"canMove": !!(drawing.canMove && drawing.canMove()),
			"canResize": !!(drawing.canResize && drawing.canResize()) };
		// Rotation handle above the top edge, where sdkjs looks for it (hitToHandles)
		if (drawing.canRotate && drawing.canRotate()) {
			var distance = drawing.convertPixToMM(AscCommon.TRACK_DISTANCE_ROTATE);
			result["rotate"] = [drawing.transform.TransformPointX(drawing.extX / 2, -distance),
				drawing.transform.TransformPointY(drawing.extX / 2, -distance)];
		}
		return result;
	});
}

// sdkjs' drawing states (moving, resizing and rotating shapes) read the global mouse state,
// which the web editor updates for each mouse event. type: 0 down, 1 move, 2 up
function mouseEvent(type, clickCount, addToSelection) {
	var global = AscCommon.global_mouseEvent;
	var e = new AscCommon.CMouseEventHandler();
	// The spreadsheet editor's controller reads browser-style fields (button, ctrlKey, isLocked)
	e.button = e.Button = global.Button = 0;
	e.metaKey = false;
	e.ClickCount = global.ClickCount = clickCount;
	e.CtrlKey = e.ctrlKey = global.CtrlKey = !!addToSelection;
	e.ShiftKey = e.shiftKey = global.ShiftKey = false;
	global.AltKey = false;
	if (type === 0) {
		e.Type = global.Type = AscCommon.g_mouse_event_type_down;
		global.IsPressed = true;
		global.IsLocked = true;
	} else if (type === 1) {
		e.Type = global.Type = AscCommon.g_mouse_event_type_move;
		// The web editor locks the mouse while a button is down; drags of shapes need it
		e.IsPressed = true;
		e.IsLocked = e.isLocked = true;
	} else {
		e.Type = global.Type = AscCommon.g_mouse_event_type_up;
		global.IsPressed = false;
		global.IsLocked = false;
	}
	return e;
}

function rgbColor(hex) {
	var result = new Asc.asc_CColor();
	result.asc_putType(Asc.c_oAscColor.COLOR_TYPE_SRGB);
	result.asc_putR(parseInt(hex.substring(0, 2), 16));
	result.asc_putG(parseInt(hex.substring(2, 4), 16));
	result.asc_putB(parseInt(hex.substring(4, 6), 16));
	return result;
}

// Shape properties with a fill: a color as "RRGGBB", or "" for none
function shapeFill(hex) {
	var fill = new Asc.asc_CShapeFill();
	if (hex) {
		var solid = new Asc.asc_CFillSolid();
		solid.asc_putColor(rgbColor(hex));
		fill.asc_putType(Asc.c_oAscFill.FILL_TYPE_SOLID);
		fill.asc_putFill(solid);
	} else {
		fill.asc_putType(Asc.c_oAscFill.FILL_TYPE_NOFILL);
	}
	var properties = new Asc.asc_CShapeProperty();
	properties.asc_putFill(fill);
	return properties;
}

// Shape properties with an outline: a color as "RRGGBB" ("" for none) and a width in mm
function shapeOutline(hex, width) {
	var stroke = new Asc.asc_CStroke();
	if (hex) {
		stroke.asc_putType(Asc.c_oAscStrokeType.STROKE_COLOR);
		stroke.asc_putColor(rgbColor(hex));
		stroke.asc_putWidth(width);
	} else {
		stroke.asc_putType(Asc.c_oAscStrokeType.STROKE_NONE);
	}
	var properties = new Asc.asc_CShapeProperty();
	properties.asc_putStroke(stroke);
	return properties;
}

// A picture the app copied into the document's images directory, as if loaded: sdkjs' image
// loader would load it in a browser
function preloadImage(api, name, width, height) {
	var image = new AscFonts.CImage(name);
	image.Image = { "width": width, "height": height };
	image.Status = AscFonts.ImageLoadStatus.Complete;
	api.ImageLoader.map_image_index[name] = image;
}

// Hit testing of shapes and pictures. sdkjs builds a shape's outline on a canvas and asks
// isPointInPath; native.js's canvas always answers no, so nothing can be tapped. This context
// records the path (curves as line segments) and answers with the nonzero winding rule.
function createHitContext() {
	var CURVE_STEPS = 16;
	var subpaths = [];
	var current = null;

	function point() {
		return current ? [current[current.length - 2], current[current.length - 1]] : [0, 0];
	}

	var context = {
		beginPath: function () { subpaths = []; current = null; },
		moveTo: function (x, y) { current = [x, y]; subpaths.push(current); },
		lineTo: function (x, y) {
			if (!current)
				context.moveTo(x, y);
			else
				current.push(x, y);
		},
		quadraticCurveTo: function (cx, cy, x, y) {
			var start = point();
			for (var i = 1; i <= CURVE_STEPS; ++i) {
				var t = i / CURVE_STEPS, u = 1 - t;
				context.lineTo(u * u * start[0] + 2 * u * t * cx + t * t * x, u * u * start[1] + 2 * u * t * cy + t * t * y);
			}
		},
		bezierCurveTo: function (c1x, c1y, c2x, c2y, x, y) {
			var start = point();
			for (var i = 1; i <= CURVE_STEPS; ++i) {
				var t = i / CURVE_STEPS, u = 1 - t;
				context.lineTo(u * u * u * start[0] + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
					u * u * u * start[1] + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y);
			}
		},
		rect: function (x, y, w, h) {
			context.moveTo(x, y); context.lineTo(x + w, y); context.lineTo(x + w, y + h); context.lineTo(x, y + h); context.closePath();
		},
		closePath: function () {
			if (current && current.length > 2)
				current.push(current[0], current[1]);
		},
		isPointInPath: function (px, py) {
			var winding = 0;
			subpaths.forEach(function (path) {
				// Subpaths are filled as if closed
				var n = path.length;
				for (var i = 0; i < n; i += 2) {
					var x0 = path[i], y0 = path[i + 1];
					var x1 = path[(i + 2) % n], y1 = path[(i + 3) % n];
					if (y0 <= py) {
						if (y1 > py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) > 0)
							++winding;
					} else if (y1 <= py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) < 0) {
						--winding;
					}
				}
			});
			return winding !== 0;
		}
	};
	// Canvas calls that don't change the path
	["save", "restore", "fill", "stroke", "clip", "setTransform", "transform", "translate", "scale", "rotate",
		"arc", "arcTo", "ellipse", "fillRect", "strokeRect", "clearRect", "setLineDash"].forEach(function (name) {
		context[name] = function () {};
	});
	return context;
}

(function (window) {
	var api = window["Asc"]["editor"];
	if (api.editorId === AscCommon.c_oEditorId.Spreadsheet) {
		spreadsheetEngine(window, api);
		return;
	}
	var logicDocument = api.WordControl.m_oLogicDocument;
	var drawingDocument = api.WordControl.m_oDrawingDocument;
	var native = window["native"];
	var isPresentation = api.editorId === AscCommon.c_oEditorId.Presentation;

	// Lay out with timers, as the web editor does, instead of the whole document at once
	window["NATIVE_EDITOR_ENJINE_SYNC_RECALC"] = false;

	// docpostype_DrawingObjects of word/Editor/Document.js (not exported)
	var DOC_POS_DRAWING_OBJECTS = 0x03;

	// What differs between the editors: pages, layout and where selections come from.
	// Selections are collected from the document in getState(), because the web editor draws
	// them on an overlay canvas the engine doesn't have.
	var documentEditor = {
		layout: function () {
			logicDocument.MoveCursorToStartPos();
			logicDocument.RecalculateFromStart();
		},
		pageCount: function () { return drawingDocument.m_lPagesCount; },
		pageWidth: function (page) { return drawingDocument.m_arrPages[page].width_mm; },
		pageHeight: function (page) { return drawingDocument.m_arrPages[page].height_mm; },
		isLayoutPending: function () {
			return logicDocument.FullRecalc.Id !== null || !!logicDocument.HdrFtrRecalc.Id;
		},
		drawTextSelection: function () {
			if (!logicDocument.IsSelectionUse() || logicDocument.IsSelectionEmpty())
				return;
			for (var page = 0; page < drawingDocument.m_lPagesCount; ++page)
				logicDocument.DrawSelectionOnPage(page);
		},
		drawingController: function () { return logicDocument.DrawingObjects; },
		// Selected pictures and shapes, with the page each one is on
		selectedDrawings: function () {
			// Not while editing the text of a shape
			var controller = logicDocument.DrawingObjects;
			if (!controller || logicDocument.GetDocPosType() !== DOC_POS_DRAWING_OBJECTS || controller.getTargetDocContent())
				return [];
			return controller.getSelectedArray().map(function (drawing) {
				return { drawing: drawing, page: drawing.selectStartPage !== undefined && drawing.selectStartPage !== -1
					? drawing.selectStartPage : drawing.parent.PageNum };
			});
		}
	};

	var presentationEditor = {
		layout: function () {
			api.asc_nativeCalculateFile();
		},
		pageCount: function () { return logicDocument.GetSlidesCount(); },
		pageWidth: function () { return logicDocument.GetWidthMM(); },
		pageHeight: function () { return logicDocument.GetHeightMM(); },
		isLayoutPending: function () { return false; },
		// Text in a shape on the current slide; sdkjs draws it as page 0 of the shape's text
		drawTextSelection: function () {
			var controller = logicDocument.GetCurrentController();
			var content = controller && controller.getTargetDocContent();
			if (!content || !content.IsSelectionUse() || content.IsSelectionEmpty())
				return;
			selectionPage = logicDocument.CurPage;
			controller.drawTextSelection(logicDocument.CurPage);
			selectionPage = null;
		},
		drawingController: function () { return logicDocument.GetCurrentController(); },
		selectedDrawings: function () {
			var controller = logicDocument.GetCurrentController();
			if (!controller || controller.getTargetDocContent())
				return [];
			return controller.getSelectedArray().map(function (drawing) {
				return { drawing: drawing, page: logicDocument.CurPage };
			});
		}
	};

	var editor = isPresentation ? presentationEditor : documentEditor;
	drawingDocument.CanvasHitContext = createHitContext();

	// sdkjs switches slides (after adding one, ...) through the web editor's view, which
	// returns early without one
	if (isPresentation) {
		api.WordControl.GoToPage = function (slide) {
			if (slide < 0 || slide >= logicDocument.GetSlidesCount())
				return;
			drawingDocument.SlideCurrent = slide;
			logicDocument.Set_CurPage(slide);
		};
		api.WordControl.GetSlidesCount = function () { return logicDocument.GetSlidesCount(); };
		api.WordControl.onNextPage = function () { api.WordControl.GoToPage(logicDocument.CurPage + 1); };
		api.WordControl.onPrevPage = function () { api.WordControl.GoToPage(logicDocument.CurPage - 1); };
	}
	// Page for selections sdkjs draws relative to a shape (presentations)
	var selectionPage = null;

	// Builder mode opens documents without layout, interface events or undo history
	api.asc_SetSilentMode(false);
	AscCommon.History.TurnOnChanges();
	editor.layout();
	api.ShowParaMarks = false;

	// Directories for fonts and the document's images; passing a plain object (not the
	// native control) keeps the app image the engine attached to the graphics object
	var resources = {
		"isResourcesObject": true,
		"fontsDirectory": native["GetFontsDirectory"](),
		"imagesDirectory": native["GetImagesPath"]()
	};

	var engine = window["eoEngine"] = {};

	// Graphics object for the next tile; the engine attaches its pixel buffer before drawTile()
	engine["tile"] = null;

	engine["getPageCount"] = function () {
		return editor.pageCount();
	};

	engine["getPageWidth"] = function (page) {
		return editor.pageWidth(page);
	};

	engine["getPageHeight"] = function (page) {
		return editor.pageHeight(page);
	};

	engine["beginTile"] = function () {
		engine["tile"] = new AscCommon.CNativeGraphics();
	};

	// Draws the area (x, y, width, height) of a page rendered at pageWidth x pageHeight pixels
	engine["drawTile"] = function (page, pageWidth, pageHeight, x, y, width, height) {
		var widthMm = editor.pageWidth(page);
		var heightMm = editor.pageHeight(page);
		var mmPerPixelX = widthMm / pageWidth;
		var mmPerPixelY = heightMm / pageHeight;

		var g = engine["tile"];
		g.width = width;
		g.height = height;
		g.create(resources, width, height, width * mmPerPixelX, height * mmPerPixelY);
		g.CoordTransformOffset(-x, -y);
		g.transform(1, 0, 0, 1, 0, 0);

		// Paper
		g.b_color1(255, 255, 255, 255);
		g._s();
		g._m(0, 0);
		g._l(widthMm, 0);
		g._l(widthMm, heightMm);
		g._l(0, heightMm);
		g._z();
		g.df();

		logicDocument.DrawPage(page, g);

		// Releases the engine's app image, not its pixel buffer
		g.Native["Destroy"]();
		engine["tile"] = null;
	};

	// ---------------------------------------------------------------------------------
	// Editing. The app reads the editor's view state after each command (getState):
	// cursor, selection, pages to draw again and the toolbar state. The drawing document
	// computes these for the web editor's overlay; its methods are wrapped to keep them.
	// Positions are page millimeters, already transformed for text in shapes.

	var state = {
		"cursor": null,       // {page, x1, y1, x2, y2} of the cursor line, or null when hidden
		"selection": [],      // [{page, points: [x1, y1, ... x4, y4]}]
		"drawings": [],       // selected pictures and shapes: [{page, points: [x1, y1, ... x4, y4]}]
		"dirtyPages": {},     // pages to draw again
		"layoutChanged": false,
		"layoutPending": false, // pages still to lay out: call tick()
		"currentPage": -1,     // presentations: the current slide
		"modified": false,     // changed since opening or the last save
		"error": null,         // exception of the last command (see reportError), reported once
		"interface": {}       // asc_on* values: bold, italic, canUndo, ...
	};
	var cursorVisible = false;
	var cursorPosition = null;

	function transformPoint(x, y) {
		var matrix = drawingDocument.TextMatrix;
		if (!matrix)
			return [x, y];
		return [matrix.TransformPointX(x, y), matrix.TransformPointY(x, y)];
	}

	function updateCursor() {
		if (!cursorVisible || !cursorPosition) {
			state["cursor"] = null;
			return;
		}
		var height = drawingDocument.m_dTargetSize;
		var top = transformPoint(cursorPosition.x, cursorPosition.y);
		var bottom = transformPoint(cursorPosition.x, cursorPosition.y + height);
		state["cursor"] = { "page": cursorPosition.page, "x1": top[0], "y1": top[1], "x2": bottom[0], "y2": bottom[1] };
	}

	function wrap(name, after) {
		var original = drawingDocument[name];
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
	wrap("TargetShow", function () {
		cursorVisible = true;
		updateCursor();
	});
	wrap("TargetEnd", function () {
		cursorVisible = false;
		updateCursor();
	});
	// Collects the selection drawn by sdkjs (see updateSelection) instead of drawing it
	drawingDocument["AddPageSelection"] = function (page, x, y, w, h) {
		var points = [];
		[[x, y], [x + w, y], [x + w, y + h], [x, y + h]].forEach(function (corner) {
			points = points.concat(transformPoint(corner[0], corner[1]));
		});
		state["selection"].push({ "page": selectionPage !== null ? selectionPage : page, "points": points });
	};

	function updateSelection() {
		state["selection"] = [];
		// Text in shapes sets its transform while drawing; the cursor keeps its own
		var textMatrix = drawingDocument.TextMatrix;
		editor.drawTextSelection();
		drawingDocument.TextMatrix = textMatrix;

		state["drawings"] = drawingStates(editor.selectedDrawings(), editor.drawingController());
	}

	function pageChanged(page) {
		state["dirtyPages"][page] = true;
		state["layoutChanged"] = true;
	}

	if (isPresentation) {
		// Replaced: the web editor also redraws its cached slide picture and thumbnails here
		drawingDocument["OnRecalculateSlide"] = function (index) {
			api.sendEvent("asc_onDocumentChanged");
			pageChanged(index);
		};
	} else {
		wrap("OnRecalculatePage", pageChanged);
		wrap("OnRepaintPage", function (page) {
			state["dirtyPages"][page] = true;
		});
	}
	wrap("OnEndRecalculate", function () {
		state["layoutChanged"] = true;
	});

	["asc_onBold", "asc_onItalic", "asc_onUnderline", "asc_onStrikeout", "asc_onCanUndo", "asc_onCanRedo",
		"asc_onPrAlign", "asc_onDocumentModifiedChanged"].forEach(function (name) {
		api.asc_registerCallback(name, function (value) {
			state["interface"][name.substring("asc_on".length)] = value;
		});
	});

	// Interface updates (bold, italic, ...) wait for the web editor's "document loaded"
	// step (onDocumentContentReady), which builder mode doesn't run
	api.isDocumentLoadComplete = true;

	// Cursor and toolbar state for the start
	logicDocument.Document_UpdateInterfaceState();
	logicDocument.Document_UpdateSelectionState();

	// State as JSON; pages to draw again and layout changes are reported once
	engine["getState"] = function () {
		updateSelection();
		state["modified"] = api.isDocumentModified();
		state["layoutPending"] = isLayoutPending();
		state["currentPage"] = isPresentation ? logicDocument.CurPage : -1;
		try {
			state["format"] = formatState();
		} catch (e) {
			state["format"] = {};
		}
		try {
			state["structure"] = isPresentation ? null : structureState();
		} catch (e) {
			state["structure"] = null;
		}
		try {
			state["link"] = linkAtCursor();
		} catch (e) {
			state["link"] = null;
		}
		var result = JSON.stringify(state);
		state["dirtyPages"] = {};
		state["layoutChanged"] = false;
		state["error"] = null;
		state["openUrl"] = null;
		return result;
	};

	// Commands run in try/catch (EditorDocument): an exception in sdkjs is reported with the
	// state instead of losing it
	engine["reportError"] = function (e) {
		state["error"] = String(e) + (e && e.stack ? "\n" + e.stack : "");
	};

	function isLayoutPending() {
		return timers.length > 0 && editor.isLayoutPending();
	}

	engine["tick"] = runTimers;

	// Mouse/touch input at page coordinates (mm). type: 0 down, 1 move, 2 up
	// addToSelection: like Ctrl+click, adds a picture or shape to the selected ones
	engine["mouse"] = function (type, page, x, y, clickCount, addToSelection) {
		engine["finishComposingText"]();
		var e = mouseEvent(type, clickCount, addToSelection);
		if (type === 0)
			logicDocument.OnMouseDown(e, x, y, page);
		else if (type === 1)
			logicDocument.OnMouseMove(e, x, y, page);
		else
			logicDocument.OnMouseUp(e, x, y, page);
	};

	// Selects from the start to the end point (page coordinates, mm): selection handles.
	// The old selection goes first, so pressing on it doesn't start dragging its text.
	engine["select"] = function (startPage, startX, startY, endPage, endX, endY) {
		engine["finishComposingText"]();
		logicDocument.RemoveSelection();
		var e = new AscCommon.CMouseEventHandler();
		e.Button = 0;
		e.ClickCount = 1;
		e.Type = AscCommon.g_mouse_event_type_down;
		logicDocument.OnMouseDown(e, startX, startY, startPage);
		e.Type = AscCommon.g_mouse_event_type_move;
		e.IsPressed = true;
		e.IsLocked = true;
		logicDocument.OnMouseMove(e, endX, endY, endPage);
		e.Type = AscCommon.g_mouse_event_type_up;
		e.IsPressed = false;
		logicDocument.OnMouseUp(e, endX, endY, endPage);
	};

	// Keys with web key codes (8 backspace, 13 enter, 37-40 arrows, 46 delete, ...)
	engine["keyDown"] = function (keyCode, shift, ctrl) {
		var e = new AscCommon.CKeyboardEvent();
		e.KeyCode = keyCode;
		e.ShiftKey = shift;
		e.CtrlKey = ctrl;
		logicDocument.OnKeyDown(e);
	};

	engine["enterText"] = function (text) {
		api.asc_enterText(text);
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

	// Text the keyboard is still composing (suggestions); replaced until it's committed
	var composing = false;

	engine["setComposingText"] = function (text) {
		if (!composing)
			composing = api.Begin_CompositeInput() !== false;
		api.Replace_CompositeText(codePoints(text));
	};

	engine["finishComposingText"] = function () {
		if (composing)
			api.End_CompositeInput();
		composing = false;
	};

	// Text from the keyboard: replaces the composed text, if any
	engine["commitText"] = function (text) {
		if (composing) {
			engine["setComposingText"](text);
			engine["finishComposingText"]();
		} else {
			api.asc_enterText(text);
		}
	};

	// Clipboard. Copy returns the selection as plain text (for other apps) and in sdkjs'
	// internal format (keeps formatting when pasting into a document), as JSON.
	var clipboardFormat = AscCommon.c_oAscClipboardDataFormat;

	// The web editor initializes the paste helper with its clipboard; without it, pastes
	// never end (the document's action stays open)
	AscCommon.g_specialPasteHelper.Init(api);

	engine["copy"] = function () {
		var data = {};
		api.asc_CheckCopy({
			"pushData": function (format, value) {
				data[format] = value;
			}
		}, clipboardFormat.Text | clipboardFormat.Internal);
		// The native engine copies the internal format as {sBase64, text, drawingUrls}
		var internal = data[clipboardFormat.Internal];
		return JSON.stringify({
			"text": data[clipboardFormat.Text] || "",
			"internal": (internal && internal.sBase64) || ""
		});
	};

	engine["cut"] = function () {
		api.asc_SelectionCut();
	};

	// Pastes the internal format if given, plain text otherwise
	engine["paste"] = function (text, internal) {
		engine["finishComposingText"]();
		if (internal)
			api.asc_PasteData(clipboardFormat.Internal, internal);
		else
			api.asc_PasteData(clipboardFormat.Text, text);
	};

	engine["selectAll"] = function () {
		engine["finishComposingText"]();
		logicDocument.SelectAll();
	};

	// Saving (Document::Save). After exporting to PDF, docbuilder turns builder mode's
	// silent mode back on (its recalculation counter is balanced, the interface flags
	// are not) and lays the document out again; editing continues where it was.
	var savedState = null;

	engine["beforeSave"] = function () {
		engine["finishComposingText"]();
		if (!isPresentation)
			savedState = logicDocument.SaveDocumentState();
	};

	engine["afterSave"] = function (success) {
		logicDocument.TurnOn_InterfaceEvents(false);
		if (!isPresentation)
			logicDocument.TurnOn_RecalculateCurPos(false);
		if (savedState) {
			logicDocument.LoadDocumentState(savedState);
			logicDocument.UpdateSelection();
			logicDocument.Document_UpdateInterfaceState();
		}
		savedState = null;
		if (success)
			api.SetUnchangedDocument();
	};

	// ---------------------------------------------------------------------------------
	// Text and paragraph formatting

	function hexOf(color) {
		if (!color || color.Auto)
			return "";
		var r = color.r !== undefined ? color.r : color.R, g = color.g !== undefined ? color.g : color.G, b = color.b !== undefined ? color.b : color.B;
		if (r === undefined)
			return "";
		return [r, g, b].map(function (v) { return ("0" + v.toString(16)).slice(-2); }).join("").toUpperCase();
	}

	// Formatting at the cursor or of the selection, for the formatting panel
	function formatState() {
		var textPr = logicDocument.GetCalculatedTextPr ? logicDocument.GetCalculatedTextPr() : null;
		var paraPr = logicDocument.GetCalculatedParaPr ? logicDocument.GetCalculatedParaPr() : null;
		var result = {};
		if (textPr) {
			result["FontName"] = textPr.FontFamily ? textPr.FontFamily.Name : "";
			result["FontSize"] = textPr.FontSize || 0;
			result["Strikeout"] = !!textPr.Strikeout;
			result["VertAlign"] = textPr.VertAlign || 0;
			var color = textPr.Color;
			if (textPr.Unifill && textPr.Unifill.fill && textPr.Unifill.fill.color && textPr.Unifill.fill.color.RGBA)
				color = textPr.Unifill.fill.color.RGBA;
			result["Color"] = hexOf(color);
			result["Highlight"] = textPr.HighLight && textPr.HighLight !== -1 ? hexOf(textPr.HighLight) : "";
		}
		if (paraPr && paraPr.Spacing) {
			result["LineRule"] = paraPr.Spacing.LineRule;
			result["Line"] = paraPr.Spacing.Line;
			result["SpacingBefore"] = paraPr.Spacing.Before;
			result["SpacingAfter"] = paraPr.Spacing.After;
		}
		if (isPresentation) {
			var bullet = paraPr && paraPr.Bullet;
			result["List"] = bullet && bullet.getBulletType ? bullet.getBulletType() : -1;
		} else {
			result["List"] = api.asc_GetCurrentNumberingId && api.asc_GetCurrentNumberingId() !== null ? (paraPr.NumPr ? 1 : 0) : -1;
			var styles = logicDocument.Get_Styles();
			var styleId = paraPr && paraPr.PStyle ? paraPr.PStyle : styles.Get_Default_Paragraph();
			var style = styleId && styles.Get(styleId);
			result["Style"] = style ? style.Get_Name() : "";
		}
		return result;
	}

	engine["setFontName"] = function (name) { api.put_TextPrFontName(name); };
	engine["setFontSize"] = function (size) { api.put_TextPrFontSize(size); };
	engine["setStrikeout"] = function (value) { api.put_TextPrStrikeout(value); };
	// 0 baseline, 1 subscript, 2 superscript
	engine["setBaseline"] = function (value) { api.put_TextPrBaseline(value); };
	// "RRGGBB", or "" for automatic
	engine["setTextColor"] = function (hex) {
		if (hex) {
			api.put_TextColor(rgbColor(hex));
		} else {
			var auto = new Asc.asc_CColor();
			auto.Auto = true;
			api.put_TextColor(auto);
		}
	};
	// "RRGGBB", or "" for none. SetMarkerFormat also starts the web editor's highlighter mode; it is ended right away
	engine["setHighlight"] = function (hex) {
		if (hex)
			api.SetMarkerFormat(true, true, parseInt(hex.substring(0, 2), 16), parseInt(hex.substring(2, 4), 16), parseInt(hex.substring(4, 6), 16));
		else
			api.SetMarkerFormat(true, false);
		api.SetMarkerFormat(false);
	};
	engine["clearFormatting"] = function () { api.ClearFormating(); };

	// Lists: type 0 bullets, 1 numbers; subtype: bullets 1 dot, 2 circle, 3 square, ...; numbers
	// 1 "1.", 2 "1)", 3 "I.", 4 "A.", 5 "a)", 6 "a.", 7 "i."; -1 removes the list. Text documents
	// apply it in a promise: the state is right only in the next script (see EditorDocument.setList)
	engine["setList"] = function (type, subtype) { api.put_ListType(type, subtype); };
	engine["indent"] = function (increase) {
		if (increase)
			api.IncreaseIndent();
		else
			api.DecreaseIndent();
	};
	// rule: 0 at least, 1 multiple (value e.g. 1.15), 2 exactly (value in mm)
	engine["setLineSpacing"] = function (rule, value) { api.put_PrLineSpacing(rule, value); };
	// Space before and after paragraphs in mm (-1: automatic)
	engine["setParagraphSpacing"] = function (before, after) {
		api.put_LineSpacingBeforeAfter(0, before);
		api.put_LineSpacingBeforeAfter(1, after);
	};

	// Text documents: paragraph styles
	engine["getStyles"] = function () {
		if (isPresentation)
			return "[]";
		var styles = logicDocument.Get_Styles().Style, names = [];
		for (var id in styles) {
			var style = styles[id];
			// styletype_Paragraph of word/Editor/Styles.js (not exported)
			if (style && style.Get_Type && style.Get_Type() === 1 && !(style.IsHidden && style.IsHidden()) && style.qFormat !== false)
				names.push(style.Get_Name());
		}
		return JSON.stringify(names);
	};
	engine["setStyle"] = function (name) { api.put_Style(name); };

	// Fonts the engine has (from the font index), sorted
	engine["getFonts"] = function () {
		var names = (AscFonts.g_font_infos || []).map(function (info) { return info.Name; });
		names.sort(function (a, b) { return a.localeCompare(b); });
		return JSON.stringify(names);
	};

	// Search: find selects the next or previous match (from the cursor); the state has the
	// number of matches, the current one (0-based, -1 for none) and, after replace all,
	// how many were replaced
	var search = null;
	api.asc_registerCallback("asc_onSetSearchCurrent", function (index, count) {
		if (search) {
			search["current"] = index;
			search["count"] = count;
		}
	});
	api.asc_registerCallback("asc_onReplaceAll", function (overall, replaced) {
		if (search)
			search["replaced"] = replaced;
	});
	function searchSettings(text, matchCase, wholeWords) {
		var settings = new AscCommon.CSearchSettings();
		settings.put_Text(text);
		settings.put_MatchCase(matchCase);
		settings.put_WholeWords(wholeWords);
		return settings;
	}
	engine["find"] = function (text, matchCase, wholeWords, forward) {
		search = { "count": 0, "current": -1, "replaced": -1 };
		search["count"] = api.asc_findText(searchSettings(text, matchCase, wholeWords), forward) || 0;
		if (!search["count"])
			search["current"] = -1;
		state["search"] = search;
	};
	// Replaces the current match and goes to the next one, or replaces all
	engine["replace"] = function (text, replacement, matchCase, wholeWords, all) {
		var settings = searchSettings(text, matchCase, wholeWords);
		if (!search)
			engine["find"](text, matchCase, wholeWords, true);
		search["replaced"] = -1;
		api.asc_replaceText(settings, replacement, all);
		// The matches after replacing
		var searchEngine = logicDocument.SearchEngine;
		search["count"] = all ? 0 : searchEngine.Count;
		search["current"] = all || !searchEngine.Count ? -1 : searchEngine.GetElementIndexById(searchEngine.CurId);
		allPagesChanged();
		state["search"] = search;
	};
	engine["endFind"] = function () {
		api.asc_endFindText();
		search = null;
		state["search"] = null;
	};

	// The hyperlink at the cursor ({url, anchor}) or null
	function linkAtCursor() {
		if (logicDocument.IsSelectionUse && logicDocument.IsSelectionUse())
			return null;
		var elements = api.getSelectedElements() || [];
		for (var i = 0; i < elements.length; i++) {
			if (elements[i].get_ObjectType() !== Asc.c_oAscTypeSelectElement.Hyperlink)
				continue;
			var link = elements[i].get_ObjectValue();
			return {
				"url": link.get_Value() || "",
				"anchor": (link.get_Bookmark && link.get_Bookmark()) || (link.is_TopOfDocument && link.is_TopOfDocument() ? "_top" : "")
			};
		}
		return null;
	}
	// Links within the document (bookmarks, slides) are followed here; web addresses come
	// back in the state as openUrl
	api.asc_registerCallback("asc_onHyperlinkClick", function (url) {
		state["openUrl"] = url;
	});
	engine["followLink"] = function () {
		var link = linkAtCursor();
		if (!link)
			return;
		if (!isPresentation && !link["url"]) {
			// A place in the document: the cursor goes to it
			if (link["anchor"] === "_top")
				logicDocument.MoveCursorToStartOfDocument();
			else
				logicDocument.GoToBookmark(link["anchor"], false);
			logicDocument.Document_UpdateSelectionState();
		} else {
			api.sync_HyperlinkClickCallback(link["url"] + (link["anchor"] && !isPresentation ? "#" + link["anchor"] : ""));
		}
		allPagesChanged();
	};

	// ---------------------------------------------------------------------------------
	// Document structure (documents): tables, breaks, headers and footers, page setup,
	// notes, table of contents, outline, statistics, track changes

	function selectedElement(type) {
		var elements = api.getSelectedElements() || [];
		for (var i = 0; i < elements.length; i++) {
			if (elements[i].get_ObjectType() === type)
				return elements[i].get_ObjectValue();
		}
		return null;
	}

	engine["insertTable"] = function (cols, rows) { api.put_Table(cols, rows); };
	var tableActions = {
		"rowAbove": function () { api.addRowAbove(1); },
		"rowBelow": function () { api.addRowBelow(1); },
		"columnLeft": function () { api.addColumnLeft(1); },
		"columnRight": function () { api.addColumnRight(1); },
		"deleteRow": function () { api.remRow(); },
		"deleteColumn": function () { api.remColumn(); },
		"deleteTable": function () { api.remTable(); },
		"merge": function () { if (api.CheckBeforeMergeCells()) api.MergeCells(); },
		"split": function () { if (api.CheckBeforeSplitCells()) api.SplitCell(2, 1); },
		"select": function () { api.selectTable(); }
	};
	engine["tableAction"] = function (name) { tableActions[name](); };

	// Asc.c_oAscSectionBreakType: 0 next page, 3 continuous
	engine["insertBreak"] = function (kind) {
		if (kind === "page") {
			api.put_AddPageBreak();
		} else if (kind === "column") {
			api.put_AddColumnBreak();
		} else if (kind === "sectionNextPage") {
			api.add_SectionBreak(0);
		} else if (kind === "sectionContinuous") {
			api.add_SectionBreak(3);
		} else if (kind === "line") {
			// As put_AddPageBreak; there is no API call for it
			if (logicDocument.IsSelectionLocked(AscCommon.changestype_Paragraph_Content))
				return;
			logicDocument.StartAction(AscDFH.historydescription_Document_AddPageBreak);
			logicDocument.AddToParagraph(new AscWord.CRunBreak(AscWord.break_Line));
			logicDocument.FinalizeAction();
		}
	};

	// Headers and footers: a double tap in their area edits them, as does this for the page
	engine["editHeaderFooter"] = function (page, footer) {
		if (footer)
			api.GoToFooter(page);
		else
			api.GoToHeader(page);
		allPagesChanged();
	};
	engine["endHeaderFooter"] = function () {
		api.asc_CancelHdrFtrEditing();
		allPagesChanged();
	};
	engine["setHeaderFooterOption"] = function (name, value) {
		if (name === "differentFirst")
			api.HeadersAndFooters_DifferentFirstPage(value);
		else if (name === "differentOddEven")
			api.HeadersAndFooters_DifferentOddandEvenPage(value);
		allPagesChanged();
	};
	// where: 1 header, 2 footer, -1 at the cursor; align: 0 right, 1 left, 2 center
	engine["insertPageNumber"] = function (where, align) {
		api.put_PageNum(where, align);
		allPagesChanged();
	};

	// Page setup of the current section, in mm
	engine["getPageSetup"] = function () {
		var section = api.asc_GetSectionProps();
		var columns = api.asc_GetColumnsProps();
		return JSON.stringify({
			"width": section.get_W(), "height": section.get_H(),
			"landscape": section.get_Orientation() === 1,
			"left": section.get_LeftMargin(), "top": section.get_TopMargin(),
			"right": section.get_RightMargin(), "bottom": section.get_BottomMargin(),
			"columns": columns ? columns.get_Num() : 1
		});
	};
	// The size as portrait (width < height), in the current orientation
	engine["setPageSetup"] = function (setup) {
		if (setup["landscape"] !== undefined && setup["landscape"] !== (api.asc_GetSectionProps().get_Orientation() === 1))
			api.change_PageOrient(!setup["landscape"]);
		var section = api.asc_GetSectionProps();
		if (setup["width"] !== undefined) {
			var isLandscape = section.get_Orientation() === 1;
			var shorter = Math.min(setup["width"], setup["height"]);
			var longer = Math.max(setup["width"], setup["height"]);
			section.put_W(isLandscape ? longer : shorter);
			section.put_H(isLandscape ? shorter : longer);
		}
		if (setup["left"] !== undefined) {
			section.put_LeftMargin(setup["left"]);
			section.put_TopMargin(setup["top"]);
			section.put_RightMargin(setup["right"]);
			section.put_BottomMargin(setup["bottom"]);
		}
		api.asc_SetSectionProps(section);
		if (setup["columns"] !== undefined) {
			var columns = api.asc_GetColumnsProps();
			columns.put_Num(setup["columns"]);
			columns.put_EqualWidth(true);
			api.asc_SetColumnsProps(columns);
		}
		allPagesChanged();
	};

	engine["addFootnote"] = function () { api.asc_AddFootnote(); };
	engine["addEndnote"] = function () { api.asc_AddEndnote(); };
	// From a note back to its reference in the text
	engine["endNoteEditing"] = function () {
		logicDocument.EndFootnotesEditing();
		allPagesChanged();
	};

	engine["addTableOfContents"] = function () { api.asc_AddTableOfContents(null); };
	engine["updateTableOfContents"] = function () { api.asc_UpdateTableOfContents(false); };

	// Headings: [{text, level}]
	engine["getOutline"] = function () {
		var outline = api.asc_ShowDocumentOutline();
		var result = [];
		for (var i = 0; i < outline.get_ElementsCount(); i++) {
			if (i === 0 && outline.isFirstItemNotHeader())
				continue;
			var text = (outline.get_Text(i) || "").trim();
			if (text)
				result.push({ "index": i, "text": text, "level": outline.get_Level(i) });
		}
		api.asc_HideDocumentOutline();
		return JSON.stringify(result);
	};
	engine["gotoOutline"] = function (index) {
		var outline = api.asc_ShowDocumentOutline();
		outline.goto(index);
		api.asc_HideDocumentOutline();
	};

	// Counted now (sdkjs counts in timer steps; this is the document builder's way)
	engine["getStatistics"] = function () {
		var statistics = logicDocument.Statistics;
		statistics.StartPos = 0;
		statistics.CurPage = 0;
		statistics.Pages = 0;
		statistics.Words = 0;
		statistics.Paragraphs = 0;
		statistics.SymbolsWOSpaces = 0;
		statistics.SymbolsWhSpaces = 0;
		statistics.Update_Pages(logicDocument.Pages.length);
		for (var page = 0; page < logicDocument.Pages.length; page++)
			logicDocument.DrawingObjects.documentStatistics(page, statistics);
		logicDocument.Content.forEach(function (element) { element.CollectDocumentStatistics(statistics); });
		return JSON.stringify({
			"pages": statistics.Pages, "words": statistics.Words, "paragraphs": statistics.Paragraphs,
			"symbols": statistics.SymbolsWOSpaces, "symbolsWithSpaces": statistics.SymbolsWhSpaces
		});
	};

	// Track changes; the change at the cursor (selected by next/previous) is in the state
	var revisions = [];
	api.asc_registerCallback("asc_onShowRevisionsChange", function (changes) {
		revisions = changes || [];
	});
	engine["setTrackChanges"] = function (value) { api.asc_SetTrackRevisions(value); };
	engine["reviewAction"] = function (name) {
		if (name === "next")
			api.asc_GetNextRevisionsChange();
		else if (name === "previous")
			api.asc_GetPrevRevisionsChange();
		else if (name === "accept")
			api.asc_AcceptChangesBySelection(true);
		else if (name === "reject")
			api.asc_RejectChangesBySelection(true);
		else if (name === "acceptAll")
			api.asc_AcceptAllChanges();
		else if (name === "rejectAll")
			api.asc_RejectAllChanges();
		allPagesChanged();
	};
	// Asc.c_oAscDisplayModeInReview: 0 markup, 1 final, 2 original
	engine["setReviewMode"] = function (mode) {
		api.asc_SetDisplayModeInReview(mode);
		allPagesChanged();
	};

	function structureState() {
		var header = selectedElement(Asc.c_oAscTypeSelectElement.Header);
		var change = revisions[0];
		return {
			"inTable": !!selectedElement(Asc.c_oAscTypeSelectElement.Table),
			"inHeaderFooter": !!header,
			"differentFirst": !!(header && header.get_DifferentFirst && header.get_DifferentFirst()),
			"differentOddEven": !!(header && header.get_DifferentEvenOdd && header.get_DifferentEvenOdd()),
			"inNote": !!(api.asc_IsCursorInFootnote() || api.asc_IsCursorInEndnote()),
			"trackChanges": !!api.asc_IsTrackRevisions(),
			"hasChanges": !!api.asc_HaveRevisionsChanges(),
			"change": change ? {
				"type": change.get_Type(), "user": change.get_UserName() || "",
				"date": String(change.get_DateTime() || ""), "text": typeof change.get_Value() === "string" ? change.get_Value() : ""
			} : null
		};
	}

	// Toolbar commands
	engine["setBold"] = function (value) { api.put_TextPrBold(value); };
	engine["setItalic"] = function (value) { api.put_TextPrItalic(value); };
	engine["setUnderline"] = function (value) { api.put_TextPrUnderline(value); };
	engine["setAlign"] = function (value) { api.put_PrAlign(value); };
	// Undoing a change of a drawing doesn't report the pages either: all are drawn again (the
	// app renders only the visible ones right away)
	function allPagesChanged() {
		for (var page = 0; page < editor.pageCount(); ++page)
			state["dirtyPages"][page] = true;
	}
	engine["undo"] = function () { api.Undo(); allPagesChanged(); };
	// ---------------------------------------------------------------------------------
	// Pictures and shapes

	engine["getImagesDirectory"] = function () { return native["GetImagesPath"](); };

	// Changes of pictures and shapes that don't change the layout (fill, outline, order) don't
	// tell the drawing document which pages to repaint (the web editor repaints its canvas):
	// the pages of the selected drawings are drawn again
	function drawingCommand(action) {
		return function () {
			var before = editor.selectedDrawings();
			action.apply(null, arguments);
			before.concat(editor.selectedDrawings()).forEach(function (item) {
				// The new fill or outline is only compiled when the shape is recalculated
				if (item.drawing.recalculate)
					item.drawing.recalculate();
				state["dirtyPages"][item.page] = true;
			});
		};
	}

	// Inserts a picture the app copied into the images directory as name; its size in pixels
	// goes into sdkjs' image loader, which would load it in a browser
	engine["insertImage"] = function (name, width, height) {
		engine["finishComposingText"]();
		preloadImage(api, name, width, height);
		api.AddImageUrlAction(name);
	};

	// A shape (preset name like "rect", "ellipse", "rightArrow", "line") in the middle of the
	// current page or slide, selected
	engine["insertShape"] = function (preset) {
		engine["finishComposingText"]();
		if (isPresentation) {
			api.AddShapeOnCurrentPage(preset);
		} else {
			// As the web editor's AddShapeOnCurrentPage, on the cursor's page
			logicDocument.DrawingObjects.addShapeOnPage(preset, Math.max(0, logicDocument.GetCurPage()));
		}
	};

	// Fill of the selected shapes: a color as "RRGGBB", or "" for none
	engine["setShapeFill"] = drawingCommand(function (hex) {
		api.ShapeApply(shapeFill(hex));
	});

	// Outline of the selected shapes: a color as "RRGGBB" ("" for none) and a width in mm
	engine["setShapeOutline"] = drawingCommand(function (hex, width) {
		api.ShapeApply(shapeOutline(hex, width));
	});

	// z-order of the selected drawings: 0 to front, 1 forward, 2 to back, 3 backward
	engine["arrange"] = drawingCommand(function (level) {
		if (isPresentation) {
			[api.shapes_bringToFront, api.shapes_bringForward, api.shapes_bringToBack, api.shapes_bringBackward][level].call(api);
		} else {
			var properties = new Asc.asc_CImgProperty();
			properties.ChangeLevel = level;
			api.ImgApply(properties);
		}
	});

	engine["group"] = drawingCommand(function (group) {
		if (isPresentation) {
			if (group)
				api.groupShapes();
			else
				api.unGroupShapes();
		} else {
			var properties = new Asc.asc_CImgProperty();
			properties.Group = group ? 1 : -1;
			api.ImgApply(properties);
		}
	});

	// Presentations: a slide after the current one, with the layout of the current one
	engine["addSlide"] = function () { api.AddSlide(); };
	engine["deleteSlide"] = function () { api.DeleteSlide(); };
	engine["getCurrentSlide"] = function () { return isPresentation ? logicDocument.CurPage : -1; };

	// Slides (the commands act on the current slide): [{hidden, layout, transition}]
	engine["getSlides"] = function () {
		var slides = [];
		for (var i = 0; i < logicDocument.GetSlidesCount(); i++) {
			var slide = logicDocument.Slides[i];
			var transition = slide.transition;
			var typeAndOption = transition && transition.getTypeAndOption ? transition.getTypeAndOption() : null;
			slides.push({
				"hidden": !slide.isVisible(),
				"layout": slide.Layout ? (slide.Layout.getName() || "") : "",
				"transition": transition ? {
					"type": (typeAndOption ? typeAndOption.Type : transition.get_TransitionType()) || 0,
					"option": (typeAndOption ? typeAndOption.Option : transition.get_TransitionOption()) || 0,
					"duration": transition.get_TransitionDuration() || 0,
					"onClick": transition.get_SlideAdvanceOnMouseClick() !== false,
					"after": !!transition.get_SlideAdvanceAfter(),
					"afterDuration": transition.get_SlideAdvanceDuration() || 0
				} : null,
				"notes": notesText(slide)
			});
		}
		return JSON.stringify(slides);
	};
	engine["gotoSlide"] = function (index) {
		engine["finishComposingText"]();
		api.WordControl.GoToPage(index);
	};
	engine["duplicateSlide"] = function () {
		var current = logicDocument.CurPage;
		logicDocument.shiftSlides(current + 1, [current], true);
		api.WordControl.GoToPage(current + 1);
		allPagesChanged();
	};
	// Moves the current slide to [position] (its index afterwards)
	engine["moveSlide"] = function (position) {
		var current = logicDocument.CurPage;
		if (position < 0 || position >= logicDocument.GetSlidesCount() || position === current)
			return;
		// shiftSlides takes the position before the move
		logicDocument.shiftSlides(position > current ? position + 1 : position, [current], false);
		api.WordControl.GoToPage(position);
		allPagesChanged();
	};
	engine["hideSlide"] = function (hide) {
		logicDocument.hideSlides(hide, [logicDocument.CurPage]);
		allPagesChanged();
	};

	// Layouts of the current slide's master: [{index, name}], index for addSlide and setLayout
	engine["getLayouts"] = function () {
		var all = logicDocument.GetAllLayouts();
		var master = logicDocument.getLayoutsMasterSlide ? logicDocument.getLayoutsMasterSlide() : null;
		var layouts = master ? master.sldLayoutLst : all;
		return JSON.stringify(layouts.map(function (layout) {
			return { "index": all.indexOf(layout), "name": layout.getName() || "" };
		}));
	};
	engine["addSlideWithLayout"] = function (layoutIndex) { api.AddSlide(layoutIndex); };
	engine["setLayout"] = function (layoutIndex) {
		api.ChangeLayout(layoutIndex);
		allPagesChanged();
	};

	// Speaker notes as plain text
	function notesText(slide) {
		var shape = slide.notes && slide.notes.getBodyShape ? slide.notes.getBodyShape() : null;
		var content = shape && shape.getDocContent ? shape.getDocContent() : null;
		return content ? content.GetText({ "ParaSeparator": "\n" }).replace(/\n$/, "") : "";
	}
	engine["setNotes"] = function (text) {
		var slide = logicDocument.Slides[logicDocument.CurPage];
		if (!slide || !slide.notes)
			return;
		logicDocument.StartAction(AscDFH.historydescription_Presentation_AddNewParagraph);
		var shape = slide.notes.getBodyShape() || slide.notes.createBodyShape();
		var content = shape.getDocContent();
		content.ClearContent(true);
		text.split("\n").forEach(function (line, index) {
			var paragraph = index === 0 ? content.Content[0] : new AscWord.Paragraph(content, true);
			if (index > 0)
				content.Internal_Content_Add(content.Content.length, paragraph);
			var run = new AscWord.Run(paragraph, false);
			run.AddText(line);
			paragraph.AddToContent(0, run);
		});
		slide.recalculateNotesShape && slide.recalculateNotesShape();
		logicDocument.FinalizeAction();
	};

	// Transition of the current slide (or all): Asc.c_oAscSlideTransitionTypes, its option, duration in ms
	engine["setTransition"] = function (type, option, duration, all) {
		var transition = new Asc.CAscSlideTransition();
		transition.put_TransitionType(type);
		transition.put_TransitionOption(option);
		transition.put_TransitionDuration(duration);
		api.ApplySlideTransition(transition);
		if (all)
			api.SlideTransitionApplyToAll();
	};
	engine["redo"] = function () { api.Redo(); allPagesChanged(); };
})(window);

// Spreadsheets. The active sheet is one page: its used cells and some empty ones around them.
// Tiles are drawn by the print path (WorksheetView.drawForPrint) with a print page made of the
// cells under the tile. The app draws the headings and the selection from the sheet's geometry
// (column and row boundaries, in getState when they change) and edits cells in its own text
// field; values are committed like the web cell editor does (_saveCellValueAfterEdit).
// getState has the fields of the text editors' state, so the shared toolbar and saving work,
// plus "sheet".
function spreadsheetEngine(window, api) {
	var native = window["native"];
	var engine = window["eoEngine"] = {};
	var PX_TO_MM = 25.4 / 96;
	// Empty columns and rows shown after the used ones, to type into
	var EXTRA_COLS = 10, EXTRA_ROWS = 50, MIN_COLS = 26, MIN_ROWS = 100;

	api.asc_SetSilentMode(false);
	AscCommon.History.TurnOnChanges();
	// Calculates the view: column widths, row heights, charts and other drawings
	api.asc_nativeCalculateFile();
	AscCommon.g_specialPasteHelper.Init(api);

	var resources = {
		"isResourcesObject": true,
		"fontsDirectory": native["GetFontsDirectory"](),
		"imagesDirectory": native["GetImagesPath"]()
	};

	function view() {
		return api.wb.getWorksheet();
	}

	function model() {
		return view().model;
	}

	// Boundaries of the columns and rows shown, in mm from the sheet's top left corner
	var geometry = null;
	var geometryKey = "";
	var geometryChanged = true;

	function updateGeometry() {
		var ws = view();
		var colCount = Math.max(model().getColsCount() + EXTRA_COLS, MIN_COLS);
		var rowCount = Math.max(model().getRowsCount() + EXTRA_ROWS, MIN_ROWS);
		var left0 = ws._getColLeft(0), top0 = ws._getRowTop(0);
		var cols = [], rows = [];
		for (var c = 0; c <= colCount; ++c)
			cols.push(Math.round((ws._getColLeft(c) - left0) * PX_TO_MM * 100) / 100);
		for (var r = 0; r <= rowCount; ++r)
			rows.push(Math.round((ws._getRowTop(r) - top0) * PX_TO_MM * 100) / 100);
		var key = api.asc_getActiveWorksheetIndex() + ":" + cols.join(",") + ";" + rows.join(",");
		if (key !== geometryKey) {
			geometryKey = key;
			geometry = { "cols": cols, "rows": rows };
			geometryChanged = true;
		}
	}
	updateGeometry();

	engine["tile"] = null;
	engine["getPageCount"] = function () { return 1; };
	engine["getPageWidth"] = function () { return geometry.cols[geometry.cols.length - 1]; };
	engine["getPageHeight"] = function () { return geometry.rows[geometry.rows.length - 1]; };
	engine["beginTile"] = function () {
		engine["tile"] = new AscCommon.CNativeGraphics();
	};

	// First column or row whose end is after position (mm)
	function indexAt(bounds, position) {
		var low = 0, high = bounds.length - 2;
		while (low < high) {
			var middle = (low + high) >> 1;
			if (bounds[middle + 1] <= position)
				low = middle + 1;
			else
				high = middle;
		}
		return low;
	}

	engine["drawTile"] = function (page, pageWidth, pageHeight, x, y, width, height) {
		var widthMm = engine["getPageWidth"](), heightMm = engine["getPageHeight"]();
		var mmPerPixel = widthMm / pageWidth;
		var g = engine["tile"];
		g.width = width;
		g.height = height;
		g.create(resources, width, height, width * mmPerPixel, height * mmPerPixel);
		g.CoordTransformOffset(-x, -y);
		g.transform(1, 0, 0, 1, 0, 0);
		g.b_color1(255, 255, 255, 255);
		g._s(); g._m(0, 0); g._l(widthMm, 0); g._l(widthMm, heightMm); g._l(0, heightMm); g._z(); g.df();

		// The cells under the tile, as a print page starting at the tile's first cell
		var cols = geometry.cols, rows = geometry.rows;
		var c1 = indexAt(cols, x * mmPerPixel), r1 = indexAt(rows, y * mmPerPixel);
		var c2 = indexAt(cols, (x + width) * mmPerPixel), r2 = indexAt(rows, (y + height) * mmPerPixel);

		var pageData = new AscCommonExcel.CPagePrint();
		pageData.pageRange = new Asc.Range(c1, r1, c2, r2);
		pageData.pageWidth = cols[c2 + 1] - cols[c1];
		pageData.pageHeight = rows[r2 + 1] - rows[r1];
		pageData.pageClipRectWidth = pageData.pageWidth / PX_TO_MM;
		pageData.pageClipRectHeight = pageData.pageHeight / PX_TO_MM;
		pageData.pageGridLines = true;
		pageData.scale = 1;
		pageData.indexWorksheet = api.asc_getActiveWorksheetIndex();

		// Print pages start at the page's origin: move it to the first cell
		g.transform(1, 0, 0, 1, cols[c1], rows[r1]);
		g.BeginPage = g.EndPage = function () {};
		var printer = new AscCommonExcel.CPdfPrinter(api.wb.fmgrGraphics[3], api.wb.m_oFont.clone());
		printer.DocumentRenderer = g;
		view().drawForPrint(printer, pageData, 0, [pageData]);

		g.Native["Destroy"]();
		engine["tile"] = null;
	};

	// ---------------------------------------------------------------------------------
	// State and commands

	var changed = false;
	var lastError = null;

	function sheetState() {
		var ws = view();
		var selection = ws.model.selectionRange;
		var range = selection.getLast();
		var active = selection.activeCell;
		var cell = ws.model.getRange3(active.row, active.col, active.row, active.col);
		var sheets = [];
		for (var i = 0; i < api.asc_getWorksheetsCount(); ++i)
			sheets.push({ "name": api.asc_getWorksheetName(i), "hidden": api.asc_isWorksheetHidden(i) });
		return {
			"c1": range.c1, "r1": range.r1, "c2": range.c2, "r2": range.r2,
			"col": active.col, "row": active.row,
			"name": cell.getName(),
			"text": cell.getValueForEdit() || "",
			"sheets": sheets,
			"active": api.asc_getActiveWorksheetIndex()
		};
	}

	engine["getState"] = function () {
		updateGeometry();
		var ws = view();
		var active = ws.model.selectionRange.activeCell;
		var cell = ws.model.getRange3(active.row, active.col, active.row, active.col);
		var font = cell.getFont();
		var sheet = sheetState();
		if (geometryChanged)
			sheet["geometry"] = geometry;
		sheet["objects"] = drawingObjects();
		var frozen = ws.topLeftFrozenCell;
		sheet["frozenCol"] = frozen ? frozen.getCol0() : 0;
		sheet["frozenRow"] = frozen ? frozen.getRow0() : 0;
		sheet["warning"] = lastWarning;
		lastWarning = null;
		sheet["cellFormat"] = cellFormat();
		var state = {
			"cursor": null, "selection": [], "drawings": drawingStates(selectedDrawings(), drawingController()),
			"dirtyPages": changed ? { "0": true } : {},
			"layoutChanged": geometryChanged,
			"layoutPending": false,
			"currentPage": -1,
			"modified": api.asc_isDocumentModified(),
			"error": lastError,
			"interface": {
				"Bold": !!font.getBold(),
				"Italic": !!font.getItalic(),
				"Underline": font.getUnderline() !== Asc.EUnderline.underlineNone,
				"PrAlign": cell.getAlign().getAlignHorizontal(),
				"CanUndo": api.asc_getCanUndo(),
				"CanRedo": api.asc_getCanRedo()
			},
			"sheet": sheet,
			"search": search,
			"link": cellLink(),
			"openUrl": openUrl
		};
		changed = false;
		geometryChanged = false;
		lastError = null;
		openUrl = null;
		return JSON.stringify(state);
	};

	// Search in all sheets: find selects the next or previous matching cell
	var search = null;
	api.asc_registerCallback("asc_onSetSearchCurrent", function (index, count) {
		if (search) {
			search["current"] = index;
			search["count"] = count;
		}
	});
	api.asc_registerCallback("asc_onRenameCellTextEnd", function (found, replaced) {
		if (search)
			search["replaced"] = replaced;
	});
	function findOptions(text, matchCase, wholeCell, forward) {
		var options = new Asc.asc_CFindOptions();
		options.asc_setFindWhat(text);
		options.asc_setIsMatchCase(matchCase);
		options.asc_setIsWholeCell(wholeCell);
		options.asc_setScanForward(forward);
		options.asc_setScanOnOnlySheet(Asc.c_oAscSearchBy.Workbook);
		return options;
	}
	engine["find"] = edit(function (text, matchCase, wholeCell, forward) {
		search = { "count": 0, "current": -1, "replaced": -1 };
		// The result is the active cell's position here (NATIVE_EDITOR_ENJINE); the count is in the search engine
		api.asc_findText(findOptions(text, matchCase, wholeCell, forward));
		search["count"] = api.wb.SearchEngine.Count;
		if (!search["count"])
			search["current"] = -1;
	});
	// Replaces the current match and goes to the next one, or replaces all
	engine["replace"] = edit(function (text, replacement, matchCase, wholeCell, all) {
		if (!search)
			engine["find"](text, matchCase, wholeCell, true);
		var options = findOptions(text, matchCase, wholeCell, true);
		options.asc_setReplaceWith(replacement);
		options.asc_setIsReplaceAll(all);
		search["replaced"] = -1;
		api.asc_replaceText(options);
		if (all) {
			search["count"] = 0;
			search["current"] = -1;
		} else {
			engine["find"](text, matchCase, wholeCell, true);
		}
	});
	engine["endFind"] = function () {
		// asc_endFindText calls a workbook method that doesn't exist (sdkjs)
		api.wb.SearchEngine.Clear();
		search = null;
	};

	// The hyperlink in the active cell ({url, anchor}: a web address or a cell range)
	function cellLink() {
		var link = api.asc_getCellInfo().asc_getHyperlink();
		if (!link)
			return null;
		var isRange = link.asc_getType() === Asc.c_oAscHyperlinkType.RangeLink;
		return { "url": isRange ? "" : (link.asc_getHyperlinkUrl() || ""), "anchor": isRange ? (link.asc_getLocation() || "") : "" };
	}
	var openUrl = null;
	engine["followLink"] = edit(function () {
		var link = api.asc_getCellInfo().asc_getHyperlink();
		if (!link)
			return;
		if (link.asc_getType() === Asc.c_oAscHyperlinkType.RangeLink)
			api.asc_setWorksheetRange(link);
		else
			openUrl = link.asc_getHyperlinkUrl();
	});

	engine["reportError"] = function (e) {
		lastError = String(e) + (e && e.stack ? "\n" + e.stack : "");
	};

	function colorHex(color) {
		if (!color || !color.asc_getR)
			return "";
		return [color.asc_getR(), color.asc_getG(), color.asc_getB()].map(function (v) { return ("0" + v.toString(16)).slice(-2); }).join("").toUpperCase();
	}

	// Format of the active cell, for the cell format panel
	function cellFormat() {
		var info = api.asc_getCellInfo();
		var xfs = info.asc_getXfs();
		var border = xfs.getBorder ? xfs.getBorder() : null;
		var hasBorder = !!(border && ((border.b && border.b.s) || (border.t && border.t.s) || (border.l && border.l.s) || (border.r && border.r.s)));
		return {
			"numFormat": xfs.asc_getNumFormat() || "General",
			"numFormatType": xfs.asc_getNumFormatInfo() ? xfs.asc_getNumFormatInfo().asc_getType() : 0,
			"fontName": xfs.asc_getFontName() || "",
			"fontSize": xfs.asc_getFontSize() || 0,
			"strikeout": !!xfs.asc_getFontStrikeout(),
			"color": colorHex(xfs.asc_getFontColor()),
			"fill": colorHex(xfs.asc_getFillColor()),
			"wrap": !!xfs.asc_getWrapText(),
			"merged": info.asc_getMerge() === Asc.c_oAscMergeOptions.Merge || info.asc_getMerge() === Asc.c_oAscMergeOptions.MergeCenter,
			"verticalAlign": xfs.asc_getVertAlign(),
			"border": hasBorder
		};
	}

	// Commands that change cells redraw the sheet
	function edit(action) {
		return function () {
			action.apply(null, arguments);
			changed = true;
		};
	}

	// Selects the cells from (c1, r1) to (c2, r2); the active cell is (c1, r1)
	engine["selectCells"] = function (c1, r1, c2, r2) {
		if (view().isSelectOnShape) {
			drawingController().resetSelection();
			view().setSelectionShape(false);
		}
		var range = new Asc.Range(Math.min(c1, c2), Math.min(r1, r2), Math.max(c1, c2), Math.max(r1, r2));
		view().setSelection(range);
		var selection = view().model.selectionRange;
		selection.activeCell.col = c1;
		selection.activeCell.row = r1;
	};

	// The active cell's new content (text, number or formula), as typed into a cell
	engine["setCellText"] = edit(function (text) {
		var ws = view();
		var active = ws.model.selectionRange.activeCell;
		var range = ws.model.getRange3(active.row, active.col, active.row, active.col);
		var fragment = new AscCommonExcel.Fragment();
		fragment.setFragmentText(text);
		fragment.format = range.getFont().clone();
		ws._saveCellValueAfterEdit(range, [fragment], undefined, false, false);
	});

	engine["clearCells"] = edit(function () {
		api.asc_emptyCells(Asc.c_oAscCleanOptions.Text);
	});

	engine["setActiveSheet"] = edit(function (index) {
		api.asc_showWorksheet(index);
	});

	engine["setBold"] = edit(function (value) { api.asc_setCellBold(value); });
	engine["setItalic"] = edit(function (value) { api.asc_setCellItalic(value); });
	engine["setUnderline"] = edit(function (value) { api.asc_setCellUnderline(value); });
	// The same values as paragraph alignment (AscCommon.align_*)
	engine["setAlign"] = edit(function (value) { api.asc_setCellAlign(value); });
	engine["undo"] = edit(function () { api.asc_Undo(); });
	engine["redo"] = edit(function () { api.asc_Redo(); });

	// Clipboard: as for documents (see the text editors' copy)
	var clipboardFormat = AscCommon.c_oAscClipboardDataFormat;
	engine["copy"] = function () {
		var data = {};
		api.asc_CheckCopy({
			"pushData": function (format, value) {
				data[format] = value;
			}
		}, clipboardFormat.Text | clipboardFormat.Internal);
		var internal = data[clipboardFormat.Internal];
		return JSON.stringify({
			"text": data[clipboardFormat.Text] || "",
			"internal": (internal && internal.sBase64) || (typeof internal === "string" ? internal : "")
		});
	};
	engine["cut"] = edit(function () { api.asc_SelectionCut(); });
	engine["paste"] = edit(function (text, internal) {
		if (internal)
			api.asc_PasteData(clipboardFormat.Internal, internal);
		else
			api.asc_PasteData(clipboardFormat.Text, text);
	});

	// ---------------------------------------------------------------------------------
	// Pictures, shapes and charts on the sheet (in sheet millimeters, as the sheet's geometry)

	function drawingController() {
		var objectRender = view().objectRender;
		// Hit testing needs a working canvas path (see createHitContext)
		if (objectRender.drawingDocument && !objectRender.drawingDocument.eoHitContext) {
			objectRender.drawingDocument.CanvasHitContext = createHitContext();
			objectRender.drawingDocument.eoHitContext = true;
		}
		return objectRender.controller;
	}

	function selectedDrawings() {
		var controller = drawingController();
		if (!view().isSelectOnShape || controller.getTargetDocContent())
			return [];
		return controller.getSelectedArray().map(function (drawing) { return { drawing: drawing, page: 0 }; });
	}

	// Frames of all drawings on the sheet, so the app knows which taps are for them
	function drawingObjects() {
		return view().objectRender.getDrawingObjects().filter(function (object) {
			return object.graphicObject && object.graphicObject.transform;
		}).map(function (object) {
			var drawing = object.graphicObject;
			return drawingFrame(drawing.transform, drawing.extX, drawing.extY);
		});
	}

	// Touch on drawings: as the mouse in sdkjs (select, move, resize, rotate). type: 0 down, 1 move, 2 up
	engine["mouseDrawing"] = function (type, x, y, clickCount, addToSelection) {
		var controller = drawingController();
		var e = mouseEvent(type, clickCount, addToSelection);
		if (type === 0)
			controller.onMouseDown(e, x, y);
		else if (type === 1)
			controller.onMouseMove(e, x, y);
		else
			controller.onMouseUp(e, x, y);
		view().setSelectionShape(controller.getSelectedArray().length > 0);
		if (type === 2)
			changed = true;
	};

	engine["insertImage"] = edit(function (name, width, height) {
		preloadImage(api, name, width, height);
		view().objectRender.addImageDrawingObject([name], null);
		runTimers(200);
		view().setSelectionShape(drawingController().getSelectedArray().length > 0);
	});

	engine["insertShape"] = edit(function (preset) {
		api.asc_addShapeOnSheet(preset);
		view().setSelectionShape(drawingController().getSelectedArray().length > 0);
	});

	function applyShapeProperties(shapeProperties) {
		var properties = new Asc.asc_CImgProperty();
		properties.ShapeProperties = shapeProperties;
		api.asc_setGraphicObjectProps(properties);
	}

	engine["setShapeFill"] = edit(function (hex) { applyShapeProperties(shapeFill(hex)); });
	engine["setShapeOutline"] = edit(function (hex, width) { applyShapeProperties(shapeOutline(hex, width)); });
	// 0 to front, 1 forward, 2 to back, 3 backward (c_oAscDrawingLayerType)
	engine["arrange"] = edit(function (level) { api.asc_setSelectedDrawingObjectLayer(level); });
	engine["group"] = edit(function (group) {
		if (group)
			api.asc_groupGraphicsObjects();
		else
			api.asc_unGroupGraphicsObjects();
	});

	engine["getImagesDirectory"] = function () { return native["GetImagesPath"](); };

	// ---------------------------------------------------------------------------------
	// Cell formatting (the selection)

	// sdkjs refuses some changes with an error event (shifting cells of a table, ...): reported once with the state
	var lastWarning = null;
	api.asc_registerCallback("asc_onError", function (id, level) {
		lastWarning = id;
	});

	function cellColor(hex) {
		return hex ? rgbColor(hex) : null;
	}

	engine["setFontName"] = edit(function (name) { api.asc_setCellFontName(name); runTimers(200); });
	engine["setFontSize"] = edit(function (size) { api.asc_setCellFontSize(size); });
	engine["setStrikeout"] = edit(function (value) { api.asc_setCellStrikeout(value); });
	engine["setTextColor"] = edit(function (hex) { api.asc_setCellTextColor(hex ? rgbColor(hex) : rgbColor("000000")); });
	engine["setCellFill"] = edit(function (hex) { api.asc_setCellBackgroundColor(cellColor(hex)); });
	// A number format code ("General", "0.00", "0.00%", "#,##0.00 [$€-407]", "dd.mm.yyyy", "@")
	engine["setNumberFormat"] = edit(function (format) { api.asc_setCellFormat(format); runTimers(200); });
	// A number format by Asc.c_oAscNumFormatType (0 general, 1 number, 4 currency, 5 date,
	// 7 time, 8 percent, 10 text), as sdkjs builds it for the document's locale
	engine["setNumberFormatType"] = edit(function (type) {
		var info = new Asc.asc_CFormatCellsInfo();
		info.asc_setType(type);
		info.asc_setDecimalPlaces(type === 1 || type === 4 || type === 8 ? 2 : 0);
		info.asc_setSeparator(type === 1);
		if (type === 4)
			info.asc_setSymbol(api.asc_getLocale ? api.asc_getLocale() : 1033);
		var formats = api.asc_getFormatCells(info);
		api.asc_setCellFormat(formats && formats.length ? formats[0] : "General");
		runTimers(200);
	});
	engine["changeDecimals"] = edit(function (more) {
		if (more)
			api.asc_increaseCellDigitNumbers();
		else
			api.asc_decreaseCellDigitNumbers();
	});
	// Borders of the selection: "all", "outer", "bottom" or "none"
	engine["setBorders"] = edit(function (kind) {
		var o = Asc.c_oAscBorderOptions;
		var line = new Asc.asc_CBorder(Asc.c_oAscBorderStyles.Thin, rgbColor("000000"));
		var borders = [];
		if (kind === "all" || kind === "outer") {
			borders[o.Top] = borders[o.Right] = borders[o.Bottom] = borders[o.Left] = line;
		}
		if (kind === "all") {
			borders[o.InnerV] = borders[o.InnerH] = line;
		}
		if (kind === "bottom") {
			borders[o.Bottom] = line;
		}
		api.asc_setCellBorders(borders);
	});
	engine["setWrap"] = edit(function (value) { api.asc_setCellTextWrap(value); });
	engine["setMerge"] = edit(function (value) {
		api.asc_mergeCells(value ? Asc.c_oAscMergeOptions.Merge : Asc.c_oAscMergeOptions.None);
	});
	// Asc.c_oAscVAlign: 0 bottom, 1 center, 4 top
	engine["setVerticalAlign"] = edit(function (value) { api.asc_setCellVertAlign(value); });

	// ---------------------------------------------------------------------------------
	// Rows, columns, sheets

	// Whole rows and columns are not widened to the merged cells they cross (onlyCells), as in Excel
	engine["selectRows"] = function (r1, r2) {
		engine["selectCells"](0, r1, 0, r2);
		view().setSelection(new Asc.Range(0, Math.min(r1, r2), AscCommon.gc_nMaxCol0, Math.max(r1, r2)), true);
	};
	engine["selectColumns"] = function (c1, c2) {
		engine["selectCells"](c1, 0, c1, 0);
		view().setSelection(new Asc.Range(Math.min(c1, c2), 0, Math.max(c1, c2), AscCommon.gc_nMaxRow0), true);
	};
	// Asc.c_oAscInsertOptions: 1 shift right, 2 shift down, 3 columns, 4 rows
	engine["insertCells"] = edit(function (option) { api.asc_insertCells(option); });
	// Asc.c_oAscDeleteOptions: 1 shift left, 2 shift up, 3 columns, 4 rows
	engine["deleteCells"] = edit(function (option) { api.asc_deleteCells(option); });
	engine["hideRows"] = edit(function (hide) { if (hide) api.asc_hideRows(); else api.asc_showRows(); });
	engine["hideColumns"] = edit(function (hide) { if (hide) api.asc_hideColumns(); else api.asc_showColumns(); });
	engine["autoFitColumns"] = edit(function () { api.asc_autoFitColumnWidth(); });
	// Width of the selected columns in mm (converted to Excel's character widths)
	engine["setColumnWidth"] = edit(function (mm) {
		var ws = view();
		var px = mm / PX_TO_MM;
		var chars = ws.model.colWidthToCharCount ? ws.model.colWidthToCharCount(px) : px / ws.maxDigitWidth;
		api.asc_setColumnWidth(Math.max(0.5, Math.min(255, chars)));
	});
	// Height of the selected rows in mm (as points)
	engine["setRowHeight"] = edit(function (mm) { api.asc_setRowHeight(Math.max(1, Math.min(409.5, mm * 72 / 25.4))); });
	// Frozen panes at the cell (col, row): rows above and columns left of it stay; 0, 0 unfreezes
	engine["freezePanes"] = edit(function (col, row) { view().freezePane(null, col, row); });
	// Fills the selection from its filled part, as dragging the fill handle does
	engine["fillSelection"] = edit(function () { api.asc_fillHandleDone(view().model.selectionRange.getLast().clone()); });

	engine["addSheet"] = edit(function (name) { api.asc_addWorksheet(name); });
	engine["renameSheet"] = edit(function (name) { api.asc_renameWorksheet(name); });
	engine["deleteSheet"] = edit(function () { api.asc_deleteWorksheet([api.asc_getActiveWorksheetIndex()]); });
	// Moves the active sheet to before the sheet at index
	engine["moveSheet"] = edit(function (index) { api.asc_moveWorksheet(index, [api.asc_getActiveWorksheetIndex()]); });
	engine["hideSheet"] = edit(function () { api.asc_hideWorksheet([api.asc_getActiveWorksheetIndex()]); });
	engine["showSheet"] = edit(function (index) { api.asc_showWorksheet(index); });

	// Function names for formula autocomplete, sorted
	engine["getFunctions"] = function () {
		var names = [];
		api.asc_getFormulasInfo().forEach(function (group) {
			group.asc_getFormulasArray().forEach(function (formula) { names.push(formula.asc_getName()); });
		});
		names.sort();
		return JSON.stringify(names);
	};

	engine["getFonts"] = function () {
		var names = (AscFonts.g_font_infos || []).map(function (info) { return info.Name; });
		names.sort(function (a, b) { return a.localeCompare(b); });
		return JSON.stringify(names);
	};
	engine["getStyles"] = function () { return "[]"; };

	// Saving (Document::Save)
	engine["beforeSave"] = function () {};
	engine["afterSave"] = function (success) {
		if (success)
			AscCommon.History.Reset_SavedIndex();
	};
}
