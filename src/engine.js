// sdkjs side of the engine, run once after a document is opened (see Document::Open).
// Leaves docbuilder's builder mode, lays out the document (the first pages now, the others
// in slices, see tick) and draws tiles into graphics objects whose memory the native engine
// provides.
(function (window) {
	var api = window["Asc"]["editor"];
	var logicDocument = api.WordControl.m_oLogicDocument;
	var drawingDocument = api.WordControl.m_oDrawingDocument;
	var native = window["native"];

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

	// Builder mode opens documents without layout, interface events or undo history
	api.asc_SetSilentMode(false);
	AscCommon.History.TurnOnChanges();
	logicDocument.MoveCursorToStartPos();
	logicDocument.RecalculateFromStart();
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
		return drawingDocument.m_lPagesCount;
	};

	engine["getPageWidth"] = function (page) {
		return drawingDocument.m_arrPages[page].width_mm;
	};

	engine["getPageHeight"] = function (page) {
		return drawingDocument.m_arrPages[page].height_mm;
	};

	engine["beginTile"] = function () {
		engine["tile"] = new AscCommon.CNativeGraphics();
	};

	// Draws the area (x, y, width, height) of a page rendered at pageWidth x pageHeight pixels
	engine["drawTile"] = function (page, pageWidth, pageHeight, x, y, width, height) {
		var pageInfo = drawingDocument.m_arrPages[page];
		var mmPerPixelX = pageInfo.width_mm / pageWidth;
		var mmPerPixelY = pageInfo.height_mm / pageHeight;

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
		g._l(pageInfo.width_mm, 0);
		g._l(pageInfo.width_mm, pageInfo.height_mm);
		g._l(0, pageInfo.height_mm);
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
		"dirtyPages": {},     // pages to draw again
		"layoutChanged": false,
		"layoutPending": false, // pages still to lay out: call tick()
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
	// The web editor draws the selection on its overlay canvas (OnUpdateOverlay), which the
	// engine doesn't have: the selection is collected from the document in getState() instead
	drawingDocument["AddPageSelection"] = function (page, x, y, w, h) {
		var points = [];
		[[x, y], [x + w, y], [x + w, y + h], [x, y + h]].forEach(function (corner) {
			points = points.concat(transformPoint(corner[0], corner[1]));
		});
		state["selection"].push({ "page": page, "points": points });
	};

	function updateSelection() {
		state["selection"] = [];
		if (!logicDocument.IsSelectionUse() || logicDocument.IsSelectionEmpty())
			return;
		// Text in shapes sets its transform while drawing; the cursor keeps its own
		var textMatrix = drawingDocument.TextMatrix;
		for (var page = 0; page < drawingDocument.m_lPagesCount; ++page)
			logicDocument.DrawSelectionOnPage(page);
		drawingDocument.TextMatrix = textMatrix;
	}

	wrap("OnRecalculatePage", function (page) {
		state["dirtyPages"][page] = true;
		state["layoutChanged"] = true;
	});
	wrap("OnEndRecalculate", function () {
		state["layoutChanged"] = true;
	});
	wrap("OnRepaintPage", function (page) {
		state["dirtyPages"][page] = true;
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
		return timers.length > 0 && (logicDocument.FullRecalc.Id !== null || !!logicDocument.HdrFtrRecalc.Id);
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
		savedState = logicDocument.SaveDocumentState();
	};

	engine["afterSave"] = function (success) {
		logicDocument.TurnOn_InterfaceEvents(false);
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
	engine["redo"] = function () { api.Redo(); };
})(window);
