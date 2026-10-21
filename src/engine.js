// sdkjs side of the engine, run once after a document is opened (see Document::Open).
// Leaves docbuilder's builder mode, lays out the document (text documents: the first pages
// now, the others in slices, see tick) and draws tiles into graphics objects whose memory
// the native engine provides. Works for text documents and presentations: "pages" are the
// slides of a presentation (see the editor adapters below).
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

	// Timers. sdkjs continues long work on timers, like the web editor's layout of the pages
	// after the first ones; native.js ignores them. Here they wait in a queue the app runs in
	// slices (tick), between its commands.
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

	// sdkjs switches slides (after adding one, ...) through the web editor's view, which
	// returns early without one
	if (isPresentation) {
		api.WordControl.GoToPage = function (slide) {
			if (slide < 0 || slide >= logicDocument.GetSlidesCount())
				return;
			drawingDocument.SlideCurrent = slide;
			logicDocument.Set_CurPage(slide);
		};
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

		state["drawings"] = editor.selectedDrawings().map(function (selected) {
			var drawing = selected.drawing;
			var matrix = drawing.transform;
			var points = [];
			[[0, 0], [drawing.extX, 0], [drawing.extX, drawing.extY], [0, drawing.extY]].forEach(function (corner) {
				points.push(matrix.TransformPointX(corner[0], corner[1]), matrix.TransformPointY(corner[0], corner[1]));
			});
			return { "page": selected.page, "points": points };
		});
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
		var result = JSON.stringify(state);
		state["dirtyPages"] = {};
		state["layoutChanged"] = false;
		state["error"] = null;
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

	// Runs the timers queued so far (not those they queue) for up to budget milliseconds
	engine["tick"] = function (budget) {
		var end = Date.now() + budget;
		for (var count = timers.length; count > 0 && timers.length > 0 && Date.now() < end; --count) {
			var timer = timers.shift();
			try {
				timer.callback.apply(window, timer.args);
			} catch (e) {
				console.log("timer: " + e + "\n" + e.stack);
			}
		}
	};

	// Mouse/touch input at page coordinates (mm). type: 0 down, 1 move, 2 up
	engine["mouse"] = function (type, page, x, y, clickCount) {
		engine["finishComposingText"]();
		var e = new AscCommon.CMouseEventHandler();
		e.Button = 0;
		e.ClickCount = clickCount;
		if (type === 0) {
			e.Type = AscCommon.g_mouse_event_type_down;
			logicDocument.OnMouseDown(e, x, y, page);
		} else if (type === 1) {
			e.Type = AscCommon.g_mouse_event_type_move;
			e.IsPressed = true;
			logicDocument.OnMouseMove(e, x, y, page);
		} else {
			e.Type = AscCommon.g_mouse_event_type_up;
			logicDocument.OnMouseUp(e, x, y, page);
		}
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

	// Toolbar commands
	engine["setBold"] = function (value) { api.put_TextPrBold(value); };
	engine["setItalic"] = function (value) { api.put_TextPrItalic(value); };
	engine["setUnderline"] = function (value) { api.put_TextPrUnderline(value); };
	engine["setAlign"] = function (value) { api.put_PrAlign(value); };
	engine["undo"] = function () { api.Undo(); };
	// Presentations: a slide after the current one, with the layout of the current one
	engine["addSlide"] = function () { api.AddSlide(); };
	engine["deleteSlide"] = function () { api.DeleteSlide(); };
	engine["getCurrentSlide"] = function () { return isPresentation ? logicDocument.CurPage : -1; };
	engine["redo"] = function () { api.Redo(); };
})(window);

// Spreadsheets (spike): page 0 is the used range of the active sheet. Tiles are drawn by the
// print path (WorksheetView.drawForPrint), with a print page made of the cells under the tile.
function spreadsheetEngine(window, api) {
	var native = window["native"];
	var engine = window["eoEngine"] = {};
	var PX_TO_MM = 25.4 / 96;

	api.asc_SetSilentMode(false);
	AscCommon.History.TurnOnChanges();
	// Calculates the view: column widths, row heights, charts and other drawings
	api.asc_nativeCalculateFile();

	var resources = {
		"isResourcesObject": true,
		"fontsDirectory": native["GetFontsDirectory"](),
		"imagesDirectory": native["GetImagesPath"]()
	};

	function sheetView() {
		return api.wb.getWorksheet();
	}

	// Columns and rows with content, at least a screenful
	function usedRange() {
		var model = sheetView().model;
		return new Asc.Range(0, 0, Math.max(model.getColsCount(), 10) - 1, Math.max(model.getRowsCount(), 30) - 1);
	}

	function colLeft(view, col) { return view._getColLeft(col) - view._getColLeft(0); }
	function rowTop(view, row) { return view._getRowTop(row) - view._getRowTop(0); }

	engine["tile"] = null;
	engine["getPageCount"] = function () { return 1; };
	engine["getPageWidth"] = function () {
		var view = sheetView();
		return colLeft(view, usedRange().c2 + 1) * PX_TO_MM;
	};
	engine["getPageHeight"] = function () {
		var view = sheetView();
		return rowTop(view, usedRange().r2 + 1) * PX_TO_MM;
	};
	engine["beginTile"] = function () {
		engine["tile"] = new AscCommon.CNativeGraphics();
	};

	engine["drawTile"] = function (page, pageWidth, pageHeight, x, y, width, height) {
		var view = sheetView();
		var mmPerPixel = engine["getPageWidth"]() / pageWidth;
		var g = engine["tile"];
		g.width = width;
		g.height = height;
		g.create(resources, width, height, width * mmPerPixel, height * mmPerPixel);
		g.CoordTransformOffset(-x, -y);
		g.transform(1, 0, 0, 1, 0, 0);
		g.b_color1(255, 255, 255, 255);
		g._s(); g._m(0, 0); g._l(engine["getPageWidth"](), 0); g._l(engine["getPageWidth"](), engine["getPageHeight"]()); g._l(0, engine["getPageHeight"]()); g._z(); g.df();

		// The cells under the tile, as a print page starting at the tile's first cell
		var left = x * mmPerPixel / PX_TO_MM, top = y * mmPerPixel / PX_TO_MM;
		var right = (x + width) * mmPerPixel / PX_TO_MM, bottom = (y + height) * mmPerPixel / PX_TO_MM;
		var range = usedRange();
		var c1 = 0, r1 = 0, c2 = range.c2, r2 = range.r2;
		while (c1 < range.c2 && colLeft(view, c1 + 1) <= left) ++c1;
		while (r1 < range.r2 && rowTop(view, r1 + 1) <= top) ++r1;
		c2 = c1; while (c2 < range.c2 && colLeft(view, c2 + 1) < right) ++c2;
		r2 = r1; while (r2 < range.r2 && rowTop(view, r2 + 1) < bottom) ++r2;

		var pageData = new AscCommonExcel.CPagePrint();
		pageData.pageRange = new Asc.Range(c1, r1, c2, r2);
		pageData.pageWidth = (colLeft(view, c2 + 1) - colLeft(view, c1)) * PX_TO_MM;
		pageData.pageHeight = (rowTop(view, r2 + 1) - rowTop(view, r1)) * PX_TO_MM;
		pageData.pageClipRectLeft = 0;
		pageData.pageClipRectTop = 0;
		pageData.pageClipRectWidth = colLeft(view, c2 + 1) - colLeft(view, c1);
		pageData.pageClipRectHeight = rowTop(view, r2 + 1) - rowTop(view, r1);
		pageData.pageGridLines = true;
		pageData.scale = 1;
		pageData.indexWorksheet = api.wbModel.getActive();

		// Print pages start at the page's origin: move it to the first cell
		g.transform(1, 0, 0, 1, colLeft(view, c1) * PX_TO_MM, rowTop(view, r1) * PX_TO_MM);
		g.BeginPage = g.EndPage = function () {};
		var printer = new AscCommonExcel.CPdfPrinter(api.wb.fmgrGraphics[3], api.wb.m_oFont.clone());
		printer.DocumentRenderer = g;
		view.drawForPrint(printer, pageData, 0, [pageData]);

		g.Native["Destroy"]();
		engine["tile"] = null;
	};

	engine["getState"] = function () {
		return JSON.stringify({ "cursor": null, "selection": [], "drawings": [], "dirtyPages": {}, "layoutChanged": false,
			"layoutPending": false, "currentPage": -1, "modified": api.asc_isDocumentModified ? api.asc_isDocumentModified() : false,
			"error": null, "interface": {} });
	};
}
