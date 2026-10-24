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

window["setTimeout"] = function (callback, delay) {
	if (typeof callback !== "function")
		return 0;
	// Delays count: sdkjs gives up on the server's answers after one (locks, saving)
	var timer = { id: nextTimerId++, callback: callback, args: Array.prototype.slice.call(arguments, 2), due: Date.now() + (Number(delay) || 0) };
	timers.push(timer);
	return timer.id;
};

// sdkjs asks for styles of the page's elements here and there (co-editing); there are none
if (typeof window["getComputedStyle"] !== "function") {
	window["getComputedStyle"] = function () {
		return { getPropertyValue: function () { return ""; } };
	};
}

// Nor are there browser events to listen to
if (typeof document !== "undefined" && typeof document["addEventListener"] !== "function") {
	document["addEventListener"] = function () {};
	document["removeEventListener"] = function () {};
}

window["clearTimeout"] = function (id) {
	for (var i = 0; i < timers.length; ++i) {
		if (timers[i].id === id) {
			timers.splice(i, 1);
			return;
		}
	}
};

// Runs the timers queued so far that are due (not those they queue) for up to budget milliseconds
function runTimers(budget) {
	var end = Date.now() + budget;
	for (var count = timers.length; count > 0 && timers.length > 0 && Date.now() < end; --count) {
		var timer = timers.shift();
		if (timer.due > Date.now()) {
			timers.push(timer);
			continue;
		}
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
// onePage: objects stay on the page of the selected ones while they are moved (presentations,
// whose tracks don't say their slide)
function drawingStates(selected, controller, onePage) {
	var page = selected.length ? selected[0].page : -1;
	var tracks = controller && controller.arrTrackObjects || [];
	if (tracks.length && page >= 0) {
		return tracks.map(function (track) {
			var source = track.originalObject || {};
			var extX = track.resizedExtX !== undefined ? track.resizedExtX : source.extX;
			var extY = track.resizedExtY !== undefined ? track.resizedExtY : source.extY;
			return { "page": typeof track.pageIndex === "number" && !onePage ? track.pageIndex : page, "points": drawingFrame(track.transform, extX, extY), "tracking": true };
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
function mouseEvent(type, clickCount, addToSelection, extend) {
	var global = AscCommon.global_mouseEvent;
	var e = new AscCommon.CMouseEventHandler();
	// The spreadsheet editor's controller reads browser-style fields (button, ctrlKey, isLocked)
	e.button = e.Button = global.Button = 0;
	e.metaKey = false;
	e.ClickCount = global.ClickCount = clickCount;
	e.CtrlKey = e.ctrlKey = global.CtrlKey = !!addToSelection;
	e.ShiftKey = e.shiftKey = global.ShiftKey = !!extend;
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

// A color of the commands: "RRGGBB", or "theme:N", the Nth of the theme's colors (see
// getThemeColors in colorSchemeCommands), which changes with the document's color scheme
function ascColor(value) {
	var theme = /^theme:(\d+)$/.exec(value);
	if (!theme)
		return rgbColor(value);
	var result = new Asc.asc_CColor();
	result.asc_putType(Asc.c_oAscColor.COLOR_TYPE_SCHEME);
	result.asc_putValue(parseInt(theme[1], 10));
	return result;
}

function hexOfRgb(r, g, b) {
	return ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}

// The standard colors of web-apps' palettes, as "RRGGBB"
function standardColors() {
	return AscCommon.g_oStandartColors.map(function (color) { return hexOfRgb(color.R, color.G, color.B); });
}

// Shape properties with a fill: a color (see ascColor), or "" for none
function shapeFill(hex) {
	var fill = new Asc.asc_CShapeFill();
	if (hex) {
		var solid = new Asc.asc_CFillSolid();
		solid.asc_putColor(ascColor(hex));
		fill.asc_putType(Asc.c_oAscFill.FILL_TYPE_SOLID);
		fill.asc_putFill(solid);
	} else {
		fill.asc_putType(Asc.c_oAscFill.FILL_TYPE_NOFILL);
	}
	var properties = new Asc.asc_CShapeProperty();
	properties.asc_putFill(fill);
	return properties;
}

// Shape properties with an outline: a color (see ascColor; "" for none) and a width in mm
function shapeOutline(hex, width) {
	var stroke = new Asc.asc_CStroke();
	if (hex) {
		stroke.asc_putType(Asc.c_oAscStrokeType.STROKE_COLOR);
		stroke.asc_putColor(ascColor(hex));
		stroke.asc_putWidth(width);
	} else {
		stroke.asc_putType(Asc.c_oAscStrokeType.STROKE_NONE);
	}
	var properties = new Asc.asc_CShapeProperty();
	properties.asc_putStroke(stroke);
	return properties;
}

// sdkjs' print drawing of spreadsheets, which draws sheet tiles, moves what it draws to a
// printed page's place (its margins, its first cell) with a base transform (SetBaseTransform),
// which core's graphics haven't. Tiles draw the sheet at its own places: the transform is kept
// (sdkjs reads it back) but not applied. Some callers don't check for it (cell fills, pictures
// in cells).
AscCommon.CNativeGraphics.prototype.SetBaseTransform = function (matrix) {
	this.m_oBaseTransform = matrix || null;
};

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

// A comment (sdkjs' asc_CCommentData*) as JSON: text, author, time, solved, replies
function commentJson(id, data, place) {
	var replies = [];
	for (var i = 0; i < data.asc_getRepliesCount(); i++) {
		var reply = data.asc_getReply(i);
		replies.push({ "text": reply.asc_getText() || "", "user": reply.asc_getUserName() || "", "time": String(reply.asc_getTime() || "") });
	}
	var result = {
		"id": String(id), "text": data.asc_getText() || "", "user": data.asc_getUserName() || "",
		"time": String(data.asc_getTime() || ""), "quote": data.asc_getQuoteText() || "",
		"solved": !!data.asc_getSolved(), "replies": replies
	};
	for (var key in place)
		result[key] = place[key];
	return result;
}

// New comment data (sdkjs' asc_CCommentData*) from the current user
function newCommentData(Type, user, text) {
	var data = new Type();
	data.asc_putText(text);
	data.asc_putUserId(user["id"]);
	data.asc_putUserName(user["name"]);
	data.asc_putTime(String(Date.now()));
	return data;
}

// The fill or outline color (sdkjs' CUniFill) as "RRGGBB": "" for none, null for other fills
// (pictures, gradients, patterns)
function uniFillHex(fill) {
	if (!fill || !fill.fill || fill.isNoFill())
		return "";
	if (fill.fill.type !== Asc.c_oAscFill.FILL_TYPE_SOLID)
		return null;
	var color = fill.getRGBAColor();
	return hexOfRgb(color.R, color.G, color.B);
}

// The fill and outline of the first of the selected drawings ([{drawing}]), as JSON
// {fill, outline} (see uniFillHex), "null" without one
function drawingColorsJson(selected) {
	var drawing = selected.length ? selected[0].drawing : null;
	if (!drawing)
		return "null";
	var line = drawing.pen || (drawing.spPr && drawing.spPr.ln);
	return JSON.stringify({
		"fill": uniFillHex(drawing.brush || (drawing.spPr && drawing.spPr.Fill)),
		"outline": line ? uniFillHex(line.Fill) : ""
	});
}

// Pictures of choices (chart styles, table styles, slide layouts), drawn as pages with negative
// numbers: previews(kind) lists them as [{id, name, width, height}] (sizes in mm) and
// drawTile(-1 - i, ...) draws the ith (getPageWidth and getPageHeight give its size).
// kinds: kind -> [{id, name, width, height, draw(graphics)}]. Returns {draw(index, ...), size(index)}
function previewCommands(engine, resources, kinds) {
	var items = [];
	engine["previews"] = function (kind) {
		items = kinds[kind] ? kinds[kind]() : [];
		return JSON.stringify(items.map(function (item) {
			return { "id": item.id, "name": item.name, "width": item.width, "height": item.height };
		}));
	};
	function size(index) {
		var item = items[index];
		return item ? [item.width, item.height] : [1, 1];
	}
	// Draws the area (x, y, width, height) of preview index rendered at pageWidth x pageHeight pixels
	function draw(index, pageWidth, pageHeight, x, y, width, height) {
		var item = items[index];
		var g = engine["tile"];
		try {
			if (!item)
				return false;
			g.width = width;
			g.height = height;
			g.create(resources, width, height, width * item.width / pageWidth, height * item.height / pageHeight);
			g.CoordTransformOffset(-x, -y);
			g.transform(1, 0, 0, 1, 0, 0);
			g.b_color1(255, 255, 255, 255);
			g._s(); g._m(0, 0); g._l(item.width, 0); g._l(item.width, item.height); g._l(0, item.height); g._z(); g.df();
			AscFormat.ExecuteNoHistory(function () { item.draw(g); }, this, []);
			return true;
		} finally {
			g.Native["Destroy"]();
			engine["tile"] = null;
		}
	}
	return { draw: draw, size: size };
}

// Charts, the same in all editors. options: selectedDrawings() as in the editors, insert(type),
// action(name, change) for one undo step that redraws, sheet: data comes from cells
function chartCommands(engine, api, options) {
	function selectedChart() {
		var items = options.selectedDrawings();
		for (var i = 0; i < items.length; i++) {
			var drawing = items[i].drawing;
			if (drawing.getObjectType && drawing.getObjectType() === AscDFH.historyitem_type_ChartSpace)
				return drawing;
		}
		return null;
	}
	// The settings of the selected chart; true: without opening the "frame editor", which stops saving
	function settings() {
		loadChartStyles();
		return api.asc_getChartSettings(true);
	}

	// The chart styles (AscCommon.g_oChartStyles), which the web editor loads as a script of its
	// own (ChartStyles.js, with sdkjs' files here): read once a chart is edited
	function loadChartStyles() {
		var styles = AscCommon.g_oChartStyles;
		if (styles && styles[Asc.c_oAscChartTypeSettings.barNormal])
			return;
		var bytes = window["native"]["GetFileBinary"](window["native"]["GetFontsDirectory"]() + "/Charts/ChartStyles.js");
		if (!bytes || !bytes.length)
			return;
		var text = "";
		for (var i = 0; i < bytes.length; i += 8192)
			text += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
		new Function(text)();
	}

	// Asc.c_oAscChartTypeSettings
	engine["insertChart"] = function (type) { options.insert(type); };

	// SmartArt of the type (Asc.c_oAscSmartArtTypes) from its definition file [name].bin. sdkjs
	// loads these over the web; here they are read from the engine's sdkjs files first.
	// It is added in a promise: read the state with the next command.
	engine["insertSmartArt"] = function (type, name) {
		var directory = window["native"]["GetFontsDirectory"]() + "/SmartArts";
		var cache = AscCommon.g_oBinarySmartArts;
		if (!cache.drawingBin.bin)
			cache.initDrawingFromBin(window["native"]["GetFileBinary"](directory + "/SmartArtDrawing/SmartArtDrawings.bin"));
		if (!cache.dataBin[type])
			cache.initDataFromBin(type, window["native"]["GetFileBinary"](directory + "/SmartArtData/" + name + ".bin"));
		api.asc_createSmartArt(type);
	};

	// The text of a chart's title or an axis' title (CTitle), "" without
	function titleText(title) {
		var content = title && title.getDocContent && title.getDocContent();
		return content ? content.GetText({ ParaSeparator: " " }).trim() : "";
	}
	function axes(chart) {
		var plotArea = chart.chart.plotArea;
		return { horizontal: plotArea.getHorizontalAxis(), vertical: plotArea.getVerticalAxis() };
	}

	// The selected chart: {type, title, titleText, legend (Asc.c_oAscChartLegendShowSettings),
	// labels, gridlines, axes (whether it has a horizontal and vertical axis), horizontalTitle,
	// verticalTitle (their titles' texts), dataInCells}, or null
	engine["chartState"] = function () {
		var chart = selectedChart();
		if (!chart)
			return null;
		loadChartStyles();
		var current = chart.getAscSettings();
		var axis = axes(chart);
		return {
			"type": current.getType(),
			"title": current.getTitle() !== Asc.c_oAscChartTitleShowSettings.none,
			"titleText": titleText(chart.chart.title),
			"axes": !!(axis.horizontal && axis.vertical),
			"horizontalTitle": titleText(axis.horizontal && axis.horizontal.title),
			"verticalTitle": titleText(axis.vertical && axis.vertical.title),
			// Spreadsheets: the cells of its data, as "Sheet1!$A$1:$C$5"
			"range": options.sheet ? current.getRange() || "" : "",
			"legend": current.getLegendPos(),
			"labels": !!current.getShowVal(),
			"gridlines": current.getVertGridLines() !== Asc.c_oAscGridLinesSettings.none || current.getHorGridLines() !== Asc.c_oAscGridLinesSettings.none,
			"dataInCells": !!options.sheet,
			// Its style (1-based, null if none of the type's) and how many the type has
			"style": current.getStyle(),
			"styles": (AscCommon.g_oChartStyles[current.getType()] || []).length,
			"layout": layoutJson(current),
			"valueAxis": axisJson(chartAxes(current).value),
			"categoryAxis": axisJson(chartAxes(current).category)
		};
	};

	// The chart's value axis and category axis (asc_ValAxisSettings, asc_CatAxisSettings), as
	// the web editor finds them: vertical, horizontal for horizontal bars; null without one
	// (pies). put(settings, axis) gives settings the changed axis.
	function chartAxes(current) {
		var vertical = current.getVertAxisProps(), horizontal = current.getHorAxisProps();
		var isValue = function (axis) { return axis && axis.getAxisType() === Asc.c_oAscAxisType.val; };
		var isCategory = function (axis) { return axis && axis.getAxisType() !== Asc.c_oAscAxisType.val; };
		var put = function (axis) {
			return function (settings, changed) {
				if (axis === vertical)
					settings.putVertAxisProps(changed);
				else
					settings.putHorAxisProps(changed);
			};
		};
		if (isValue(vertical))
			return { value: vertical, category: isCategory(horizontal) ? horizontal : null, putValue: put(vertical), putCategory: put(horizontal) };
		if (isValue(horizontal))
			return { value: horizontal, category: isCategory(vertical) ? vertical : null, putValue: put(horizontal), putCategory: put(vertical) };
		return { value: null, category: null };
	}

	// Asc.c_oAscChartTitleShowSettings, c_oAscChartLegendShowSettings,
	// c_oAscChartHorAxisLabelShowSettings, c_oAscChartVertAxisLabelShowSettings,
	// c_oAscGridLinesSettings, c_oAscChartDataLabelsPos; axes' settings null without the axis
	function layoutJson(current) {
		var horizontal = current.getHorAxisProps(), vertical = current.getVertAxisProps();
		return {
			"title": current.getTitle(),
			"legend": current.getLegendPos(),
			"horizontalTitle": horizontal ? horizontal.getLabel() : null,
			"verticalTitle": vertical ? vertical.getLabel() : null,
			"horizontalGridlines": vertical ? vertical.getGridlines() : null,
			"verticalGridlines": horizontal ? horizontal.getGridlines() : null,
			"dataLabels": current.getDataLabelsPos()
		};
	}

	// An axis' settings: min and max (null: automatic), units (Asc.c_oAscValAxUnits), crosses
	// (Asc.c_oAscCrossesRule) at crossesValue, majorTicks and minorTicks (Asc.c_oAscTickMark),
	// labels (Asc.c_oAscTickLabelsPos), reverse; category axes position (Asc.c_oAscLabelsPosition)
	// instead of min, max and units
	function axisJson(axis) {
		if (!axis)
			return null;
		var value = axis.getAxisType() === Asc.c_oAscAxisType.val;
		var result = {
			"crosses": axis.getCrossesRule(),
			"crossesValue": axis.getCrosses(),
			"majorTicks": axis.getMajorTickMark(),
			"minorTicks": axis.getMinorTickMark(),
			"labels": axis.getTickLabelsPos(),
			"reverse": !!(value ? axis.getInvertValOrder() : axis.getInvertCatOrder())
		};
		if (value) {
			result["min"] = axis.getMinValRule() === Asc.c_oAscValAxisRule.fixed ? axis.getMinVal() : null;
			result["max"] = axis.getMaxValRule() === Asc.c_oAscValAxisRule.fixed ? axis.getMaxVal() : null;
			result["units"] = axis.getDispUnitsRule();
		} else {
			result["position"] = axis.getLabelsPosition();
		}
		return result;
	}

	// The selected chart's style, 1 to the type's count, in one undo step
	engine["setChartStyle"] = function (style) {
		var changed = settings();
		changed.startEdit();
		changed.putStyle(style);
		changed.endEdit();
	};

	// Settings of the layout, as in layoutJson: {name: value} of those to change
	engine["setChartLayout"] = function (layout) {
		var changed = settings();
		var horizontal = changed.getHorAxisProps(), vertical = changed.getVertAxisProps();
		Object.keys(layout).forEach(function (name) {
			var value = layout[name];
			switch (name) {
				case "title": changed.putTitle(value); break;
				case "legend": changed.putLegendPos(value); break;
				// sdkjs' putVertAxisLabel doesn't set it: the axes' settings do
				case "horizontalTitle": if (horizontal) horizontal.putLabel(value); break;
				case "verticalTitle": if (vertical) vertical.putLabel(value); break;
				case "horizontalGridlines": if (vertical) vertical.putGridlines(value); break;
				case "verticalGridlines": if (horizontal) horizontal.putGridlines(value); break;
				case "dataLabels":
					changed.putDataLabelsPos(value);
					changed.putShowVal(value !== Asc.c_oAscChartDataLabelsPos.none);
					break;
			}
		});
		api.asc_applyChartSettings(changed);
	};

	// Settings of the value or category axis (kind "value", "category"), as in axisJson:
	// {name: value} of those to change
	engine["setChartAxis"] = function (kind, values) {
		var changed = settings();
		var found = chartAxes(changed);
		var axis = kind === "value" ? found.value : found.category;
		if (!axis)
			return;
		var value = kind === "value";
		Object.keys(values).forEach(function (name) {
			var v = values[name];
			switch (name) {
				case "min":
				case "max":
					var rule = v === null ? Asc.c_oAscValAxisRule.auto : Asc.c_oAscValAxisRule.fixed;
					if (name === "min") {
						axis.putMinValRule(rule);
						if (v !== null) axis.putMinVal(v);
					} else {
						axis.putMaxValRule(rule);
						if (v !== null) axis.putMaxVal(v);
					}
					break;
				case "units": axis.putDispUnitsRule(v); break;
				case "crosses": axis.putCrossesRule(v); break;
				case "crossesValue":
					axis.putCrossesRule(Asc.c_oAscCrossesRule.value);
					axis.putCrosses(v);
					break;
				case "majorTicks": axis.putMajorTickMark(v); break;
				case "minorTicks": axis.putMinorTickMark(v); break;
				case "labels": axis.putTickLabelsPos(v); break;
				case "position": axis.putLabelsPosition(v); break;
				case "reverse":
					if (value) axis.putInvertValOrder(v); else axis.putInvertCatOrder(v);
					break;
			}
		});
		(value ? found.putValue : found.putCategory)(changed, axis);
		api.asc_applyChartSettings(changed);
	};

	// Pictures of the selected chart's type in its styles, with sdkjs' sample data
	if (options.previews) {
		options.previews["chartStyles"] = function () {
			var chart = selectedChart();
			loadChartStyles();
			var type = chart ? chart.getAscSettings().getType() : -1;
			var styles = AscCommon.g_oChartStyles[type] || [];
			var manager = api.chartPreviewManager;
			return styles.map(function (style, i) {
				return {
					id: i + 1, name: String(i + 1), width: 75, height: 75,
					draw: function (g) { manager.createChartPreview(g, type, style); }
				};
			});
		};
	}

	// As the web editor: changed on the chart itself, in one undo step
	engine["setChartType"] = function (type) {
		var changed = settings();
		changed.startEdit();
		if (changed.changeType(type) === false)
			changed.cancelEdit();
		else
			changed.endEdit();
	};

	// The texts of the chart's title and its axes' titles; "" removes one. The title keeps the
	// size and weight of its text
	engine["setChartTitles"] = function (title, horizontal, vertical) {
		var chart = selectedChart();
		if (!chart)
			return;
		options.action(function () {
			function textPr(old) {
				var content = old && old.getDocContent && old.getDocContent();
				if (!content)
					return {};
				content.SetApplyToAll(true);
				var pr = content.GetCalculatedTextPr();
				content.SetApplyToAll(false);
				return pr || {};
			}
			var pr = textPr(chart.chart.title);
			if (titleText(chart.chart.title) !== title)
				AscFormat.builder_SetChartTitle(chart, title, pr.FontSize, pr.Bold);
			var axis = axes(chart);
			if (axis.horizontal && titleText(axis.horizontal.title) !== horizontal) {
				pr = textPr(axis.horizontal.title);
				AscFormat.builder_SetChartHorAxisTitle(chart, horizontal, pr.FontSize, pr.Bold);
			}
			if (axis.vertical && titleText(axis.vertical.title) !== vertical) {
				pr = textPr(axis.vertical.title);
				AscFormat.builder_SetChartVertAxisTitle(chart, vertical, pr.FontSize, pr.Bold);
			}
		});
	};

	engine["setChartElements"] = function (title, legend, labels, gridlines) {
		var changed = settings();
		changed.putTitle(title ? Asc.c_oAscChartTitleShowSettings.noOverlay : Asc.c_oAscChartTitleShowSettings.none);
		changed.putLegendPos(legend);
		changed.putShowVal(labels);
		changed.putDataLabelsPos(labels ? Asc.c_oAscChartDataLabelsPos.bestFit : Asc.c_oAscChartDataLabelsPos.none);
		var lines = gridlines ? Asc.c_oAscGridLinesSettings.major : Asc.c_oAscGridLinesSettings.none;
		// The value axis' lines: vertical for horizontal bars
		var horizontalBars = changed.getType() >= Asc.c_oAscChartTypeSettings.hBarNormal && changed.getType() <= Asc.c_oAscChartTypeSettings.hBarPercent3d;
		if (horizontalBars)
			changed.putVertGridLines(lines);
		else
			changed.putHorGridLines(lines);
		api.asc_applyChartSettings(changed);
	};

	// Spreadsheets: the cells the chart shows ("Sheet1!$A$1:$C$5"), as web-apps' "Select data".
	// Returns 0 or the error (Asc.c_oAscError.ID: an invalid range, too much data)
	engine["setChartRange"] = function (range) {
		if (!options.sheet || !selectedChart())
			return 0;
		var changed = settings();
		var error = changed.isValidRange(range);
		if (error !== Asc.c_oAscError.ID.No)
			return error;
		error = new AscFormat.CChartDataRefs(null).checkDataRange(range, changed.getInRows(), changed.getType());
		if (error !== Asc.c_oAscError.ID.No)
			return error;
		changed.startEdit();
		changed.setRange(range);
		changed.endEdit();
		return 0;
	};
	// Spreadsheets: series from rows instead of columns, or the other way round
	engine["switchChartRowCol"] = function () {
		if (!options.sheet || !selectedChart())
			return 0;
		var changed = settings();
		changed.startEdit();
		var error = changed.switchRowCol();
		if (error !== Asc.c_oAscError.ID.No) {
			changed.cancelEdit();
			return error;
		}
		changed.endEdit();
		return 0;
	};
	// Spreadsheets: choosing the chart's cells on the sheet. startChartRange remembers the
	// selected chart while cells are selected; endChartRange selects it again and, with apply,
	// gives it the selected cells (setChartRange's result)
	var rangeChart = null;
	engine["startChartRange"] = function () {
		rangeChart = options.sheet ? selectedChart() : null;
		// Taps select cells, not the chart
		if (rangeChart)
			options.sheet.deselect();
	};
	engine["endChartRange"] = function (apply) {
		var chart = rangeChart;
		rangeChart = null;
		if (!chart || chart.bDeleted)
			return 0;
		var range = options.sheet.selectedRange();
		options.sheet.select(chart);
		return apply ? engine["setChartRange"](range) : 0;
	};

	// Documents and presentations: the data in the chart, as a table {series: [names],
	// categories: [names], values: [[per category] per series]}
	function pointValues(cache) {
		var values = [];
		if (cache && cache.pts) {
			cache.pts.forEach(function (point) { values[point.idx] = point.val; });
		}
		return values;
	}
	function categories(series) {
		var cat = series && (series.cat || series.xVal);
		if (!cat)
			return [];
		var cache = (cat.strRef && cat.strRef.strCache) || (cat.numRef && cat.numRef.numCache) || cat.strLit || cat.numLit;
		return pointValues(cache).map(function (value) { return value === undefined ? "" : String(value); });
	}
	engine["getChartData"] = function () {
		var chart = selectedChart();
		if (!chart || options.sheet)
			return "null";
		var all = chart.getAllSeries();
		return JSON.stringify({
			"series": all.map(function (series) {
				var tx = series.tx;
				var names = tx && tx.strRef ? pointValues(tx.strRef.strCache) : [];
				return names.length ? String(names[0]) : (tx && tx.val ? String(tx.val) : "");
			}),
			"categories": categories(all[0]),
			"values": all.map(function (series) {
				var val = series.val || series.yVal;
				var cache = val && ((val.numRef && val.numRef.numCache) || val.numLit);
				return pointValues(cache).map(function (value) { return value === undefined || value === "" ? null : Number(value); });
			})
		});
	};
	engine["setChartData"] = function (data) {
		var chart = selectedChart();
		if (!chart || options.sheet)
			return;
		options.action(function () {
			var rows = data["categories"].length;
			function column(index) {
				var name = "";
				for (index += 1; index > 0; index = Math.floor((index - 1) / 26))
					name = String.fromCharCode(65 + (index - 1) % 26) + name;
				return name;
			}
			function item(value) {
				return { numFormatStr: "General", isDateTimeFormat: false, val: value, isHidden: false };
			}
			// As the default data of a new chart (getSeriesDefault): categories in A, series in B, C, ...
			var cat = {
				Formula: "Sheet1!$A$2:$A$" + (rows + 1),
				NumCache: data["categories"].map(function (name) { return item(name); })
			};
			var plotCharts = chart.chart.plotArea.charts;
			var target = plotCharts[plotCharts.length - 1];
			var all = chart.getAllSeries();
			data["series"].forEach(function (name, index) {
				var col = column(index + 1);
				var seria = new AscFormat.asc_CChartSeria();
				seria.Val.Formula = "Sheet1!$" + col + "$2:$" + col + "$" + (rows + 1);
				seria.Val.NumCache = data["values"][index].map(function (value) { return item(value === null ? "" : value); });
				seria.TxCache.Formula = "Sheet1!$" + col + "$1";
				seria.TxCache.NumCache = [item(name)];
				seria.Cat = cat;
				seria.xVal = cat;
				var series = all[index];
				if (!series) {
					// As CChartSpace.addSeries, inside this undo step
					series = target.series[0] ? target.series[0].createDuplicate() : target.getEmptySeries();
					chart.setNewSeriesIdxAndOrder(series);
					target.addSer(series);
				}
				series.fillFromAscSeries(seria, true);
			});
			for (var i = data["series"].length; i < all.length; i++)
				all[i].remove();
			chart.reorderSeries();
			// The embedded workbook no longer matches: it is written again from the data on saving
			chart.setXLSX(new Uint8Array(0));
			chart.onDataUpdate();
		});
	};
}

// Co-editing with a Document Server. sdkjs runs its own co-authoring client (DocsCoApi) on a
// socket the app connects: window.io, which sdkjs takes as its socket.io client, queues what
// sdkjs sends (coTakeOutbox) and gets what the server sends (coReceive). The app downloads the
// files the server converted (Editor.bin) before passing its message on (coSetFile), because
// sdkjs would load them over the web.
//
// Object ids must be the same as in the other editors of the session: changes name the objects
// they change. docbuilder's load of a document gives the ids the web editors give, so the
// server's version is loaded the same way, from the same id, and the engine starts again on it
// (eoStartEngine). The session's state is kept across that (window.eoCoState).
// repaint: draws all pages again (others' locks and pictures); repaintOnMessages: also after
// the server's messages (spreadsheets: others' changes and the answers to locks, after which
// sdkjs carries out what waited for them)
// The pages as drawing commands (sdkjs' asc_nativeGetPDF), which core writes into a PDF
// (Document::ExportPdf); sdkjs gives their length through native.Save_End
function pdfCommands(api) {
	var native = window["native"], saveEnd = native["Save_End"], length = -1;
	native["Save_End"] = function (type, size) { length = size; };
	try {
		var data = api["asc_nativeGetPDF"](null);
	} finally {
		native["Save_End"] = saveEnd;
	}
	return length >= 0 ? data.slice(0, length) : data;
}

// A font name as shown: theme fonts ("+mn-lt", "+mj-lt") by the theme's font
function themeFontName(theme, name) {
	var scheme = theme && theme.themeElements && theme.themeElements.fontScheme;
	return name && scheme && scheme.checkFont ? scheme.checkFont(name) : name || "";
}

// A document's font names, sorted, without the theme's placeholders (+mn-lt, ...); the engine
// may draw some with others, as the web editor does
function documentFonts(names) {
	var found = names.filter(function (name) { return name && name.charAt(0) !== "+"; });
	found.sort(function (a, b) { return a.localeCompare(b); });
	return found;
}

// Color schemes ("Office", "Grayscale", ...: the theme's colors), as web-apps lists them: the
// built-in ones and the document's. Choosing one recolors what uses the theme's colors.
function colorSchemeCommands(engine, api, changed) {
	function hex(value) {
		return (value < 16 ? "0" : "") + value.toString(16).toUpperCase();
	}
	// {current: index or -1, schemes: [{name, colors: ["RRGGBB"]}]}
	engine["getColorSchemes"] = function () {
		var theme = api.getCurrentTheme();
		var found = theme ? api.getColorSchemes(theme) : { schemes: [], index: -1 };
		return JSON.stringify({
			"current": found.index,
			"schemes": found.schemes.map(function (scheme) {
				return {
					"name": scheme.get_name() || "",
					"colors": scheme.get_colors().map(function (color) { return hex(color.get_r()) + hex(color.get_g()) + hex(color.get_b()); })
				};
			})
		});
	};
	engine["setColorScheme"] = function (index) {
		api.asc_ChangeColorSchemeByIdx(index);
		changed();
	};

	// The colors of web-apps' palettes: {theme: ["RRGGBB"], standard: ["RRGGBB"]}. theme has 6
	// for each of the theme's 10 colors (background 1, text 1, background 2, text 2, accents 1 to
	// 6): the color, then lighter and darker ones; the Nth is "theme:N" in the commands (see
	// ascColor). sdkjs sends them when the theme's colors change, and again when asked.
	var themeColors = [];
	api.asc_registerCallback("asc_onSendThemeColors", function (colors) {
		themeColors = colors.map(function (color) { return hexOfRgb(color.get_r(), color.get_g(), color.get_b()); });
	});
	engine["getThemeColors"] = function () {
		var drawingDocument = api.WordControl && api.WordControl.m_oDrawingDocument;
		if (drawingDocument) {
			drawingDocument.GuiControlColorsMap = null;
			drawingDocument.CheckGuiControlColors(true);
		} else {
			api.GuiControlColorsMap = null;
			api.asc_CheckGuiControlColors();
		}
		return JSON.stringify({ "theme": themeColors, "standard": standardColors() });
	};
}

function coEditingCommands(engine, api, repaint, repaintOnMessages) {
	var co = window["eoCoState"] = window["eoCoState"] || {
		outbox: [], socket: null, files: {}, loading: false,
		participants: [], cursors: {}, reconnecting: false, disconnected: false, sentAuth: null
	};
	co.repaint = repaint;
	co.repaintOnMessages = !!repaintOnMessages;

	// The socket's settings go to the app's socket.io client: reconnecting (sdkjs' settings from
	// the server) and the tokens to authenticate with when it does
	function reconnection(name) {
		return function (value) { co.outbox.push({ "type": "reconnection", "name": name, "value": value }); };
	}

	function EngineSocket(options) {
		var self = this;
		this.options = options;
		this.events = {};
		this.managerEvents = {};
		this.io = {
			opts: { transports: options["transports"] },
			on: function (name, callback) { (self.managerEvents[name] = self.managerEvents[name] || []).push(callback); },
			reconnectionAttempts: reconnection("attempts"),
			reconnectionDelay: reconnection("delay"),
			reconnectionDelayMax: reconnection("delayMax"),
			setOpenToken: function (token) { options["auth"]["token"] = token; },
			setSessionToken: function (token) { options["auth"]["session"] = token; }
		};
		co.sentAuth = authTokens(options);
		co.outbox.push({ "type": "connect", "options": options });
	}

	function authTokens(options) {
		var auth = options["auth"] || {};
		return JSON.stringify({ "token": auth["token"] || null, "session": auth["session"] || null });
	}
	EngineSocket.prototype.on = function (name, callback) {
		(this.events[name] = this.events[name] || []).push(callback);
	};
	EngineSocket.prototype.emit = function (name, data) {
		co.outbox.push({ "type": "emit", "name": name, "data": data });
	};
	EngineSocket.prototype.connect = function () {
		co.outbox.push({ "type": "connect", "options": this.options });
	};
	EngineSocket.prototype.disconnect = function () {
		co.outbox.push({ "type": "disconnect" });
	};
	EngineSocket.prototype.close = EngineSocket.prototype.disconnect;
	EngineSocket.prototype.open = EngineSocket.prototype.connect;
	EngineSocket.prototype.fire = function (events, name, args) {
		(events[name] || []).forEach(function (callback) { callback.apply(null, args); });
	};

	window["io"] = function (options) {
		co.socket = new EngineSocket(options);
		return co.socket;
	};

	// Pictures: sdkjs learns their URLs on the server (the document's, then those of pictures
	// others add); the engine draws them from its images directory, so the app downloads them
	// there (coImageLoaded)
	if (!co.urlsHooked) {
		co.urlsHooked = true;
		var documentUrls = AscCommon.g_oDocumentUrls;
		var addUrls = documentUrls.addUrls;
		documentUrls.addUrls = function (urls) {
			addUrls.apply(this, arguments);
			if (!co.socket)
				return;
			for (var name in urls) {
				if (name.indexOf(documentUrls.mediaPrefix) === 0)
					co.outbox.push({ "type": "fetch", "url": urls[name], "name": name.substring(documentUrls.mediaPrefix.length) });
			}
		};
	}

	// Others' cursors, which the web editor draws on its overlay (positions on the page, mm)
	function foreignCursor(id, shortId, x, y, size, page, transform) {
		function point(px, py) {
			return transform ? [transform.TransformPointX(px, py), transform.TransformPointY(px, py)] : [px, py];
		}
		var top = point(x, y);
		var bottom = point(x, y + size);
		co.cursors[id] = { "user": id, "shortId": shortId, "page": page, "x1": top[0], "y1": top[1], "x2": bottom[0], "y2": bottom[1] };
	}
	var drawingDocument = api.WordControl && api.WordControl.m_oDrawingDocument;
	if (drawingDocument) {
		drawingDocument.Collaborative_UpdateTarget = foreignCursor;
		drawingDocument.Collaborative_RemoveTarget = function (id) { delete co.cursors[id]; };
		drawingDocument.Collaborative_TargetsUpdate = function () {};
	}

	// Parts others locked are framed in red, as in the web editor; core's graphics would frame
	// all of them in green, own ones too
	var graphics = AscCommon.CNativeGraphics.prototype;
	function isOthersLock(type) {
		return type !== AscCommon.c_oAscLockTypes.kLockTypeNone && !api.isViewMode &&
			!(type === AscCommon.c_oAscLockTypes.kLockTypeMine && AscCommon.CollaborativeEditing.Is_Fast());
	}
	graphics.DrawLockParagraph = function (type, x, y1, y2) {
		if (!isOthersLock(type))
			return;
		this.p_color(238, 53, 37, 255);
		this.p_width(300);
		this._s();
		this._m(x + 1, y1);
		this._l(x, y1);
		this._l(x, y2);
		this._l(x + 1, y2);
		this.ds();
	};
	graphics.DrawLockObjectRect = function (type, x, y, w, h) {
		if (!isOthersLock(type) || this.IsThumbnail)
			return;
		var margin = 1;
		this.p_color(238, 53, 37, 255);
		this.p_width(300);
		this._s();
		this._m(x - margin, y - margin);
		this._l(x + w + margin, y - margin);
		this._l(x + w + margin, y + h + margin);
		this._l(x - margin, y + h + margin);
		this._z();
		this.ds();
	};
	// A lock changes: pages are drawn again (the web editor repaints its canvas)
	if (!co.locksHooked) {
		co.locksHooked = true;
		var setType = AscCommon.CLock.prototype.Set_Type;
		AscCommon.CLock.prototype.Set_Type = function () {
			setType.apply(this, arguments);
			co.locksChanged = true;
		};
	}

	// The web editors number objects from 0 until the user is known, and load the document right
	// after the table of objects (id 1): the document's objects are numbered from there, by the
	// same code that loads it here
	var isSpreadsheet = api.editorId === AscCommon.c_oEditorId.Spreadsheet;
	var ID_START = 1;

	// Loading a document sets up the web editor's text input element and touch scrolling; the
	// app has its own
	AscCommon.InitBrowserInputContext = function () {};
	if (api.WordControl)
		api.WordControl.initEventsMobile = function () {};

	// docbuilder makes sdkjs hand its changes to docbuilder instead of the server
	// (asc_nativeOpenFile): sdkjs' own versions again (common/docscoapi.js)
	function sendChangesToServer() {
		var coApi = AscCommon.CDocsCoApi.prototype;
		coApi.askSaveChanges = function (callback) {
			if (this._CoAuthoringApi && this._onlineWork) {
				this._CoAuthoringApi.askSaveChanges(callback);
			} else {
				window.setTimeout(function () {
					if (callback)
						callback({ "saveLock": false });
				}, 100);
			}
		};
		coApi.saveChanges = function (arrayChanges, deleteIndex, excelAdditionalInfo, canUnlockDocument, canReleaseLocks) {
			if (this._CoAuthoringApi && this._onlineWork) {
				this._CoAuthoringApi.canUnlockDocument = canUnlockDocument;
				this._CoAuthoringApi.canReleaseLocks = canReleaseLocks;
				this._CoAuthoringApi.saveChanges(arrayChanges, null, deleteIndex, excelAdditionalInfo);
			}
		};
	}
	sendChangesToServer();
	co.sendChangesToServer = sendChangesToServer;

	// The document as the server converted it, from the file the app downloaded: loaded as
	// docbuilder loads (the same ids as the web editors), then the session's changes are applied
	// as in the web editors and the engine starts again on the new document
	api._onOpenCommand = function (url) {
		var path = co.files[url];
		var data = path ? window["native"]["GetFileBinary"](path) : null;
		if (!data) {
			api.sendEvent("asc_onError", Asc.c_oAscError.ID.DownloadError, Asc.c_oAscError.Level.Critical);
			return;
		}
		var counter = AscCommon.g_oIdCounter;
		var userId = counter.m_sUserId;
		var user = api.User;
		// The table of objects keeps its id: changes that add objects are addressed to it
		var table = AscCommon.g_oTableId;
		var tableId = table.Id;
		table.Clear();
		delete table.m_aPairs[table.Id];
		table.Id = tableId;
		table.m_aPairs[tableId] = table;
		counter.Clear();
		counter.m_nIdCounterLoad = ID_START;
		counter.Set_Load(true);
		// Presentations: the web editor's page (panes, scroll bars) was set up with the first
		// document; again it fails without a page
		var initPage = api.editorId === AscCommon.c_oEditorId.Presentation && api.WordControl.Init;
		if (initPage)
			api.WordControl.Init = function () {};
		// Spreadsheets: the load starts co-editing, which runs already
		var coAuthoringInit = api._coAuthoringInit;
		api._coAuthoringInit = function () {};
		try {
			api.asc_nativeOpenFile(data, undefined, true);
		} finally {
			if (initPage)
				api.WordControl.Init = initPage;
			api._coAuthoringInit = coAuthoringInit;
		}
		counter.Set_Load(false);
		if (userId !== null)
			counter.Set_UserId(userId);
		api.User = user;
		if (isSpreadsheet) {
			sendChangesToServer();
			co.loading = true;
			api.isDocumentLoadComplete = false;
			// The end of the web editor's open, without its page: the session's changes and
			// locks (onDocumentContentReady when the changes are applied)
			api.asc_nativeCalculateFile();
			api._applyFirstLoadChanges();
			api._applyPreOpenLocks();
			// Opened: sdkjs doesn't save while it opens
			api.advancedOptionsAction = AscCommon.c_oAscAdvancedOptionsAction.None;
			window.setTimeout(restartEngine, 0);
			return;
		}
		// A document opened from data, as the web editors' open sets it (not a new one)
		api.DocumentType = 2;
		sendChangesToServer();
		co.loading = true;
		api.isDocumentLoadComplete = false;
		// The web editors wait for the document's images here; docbuilder's load has them
		api.ServerImagesWaitComplete = true;
		try {
			api._openDocumentEndCallback();
		} catch (e) {
			// Handlers of the web editor's page (presentations: thumbnails) fail without one
			console.log("co-editing: opening: " + e);
		}
		window.setTimeout(restartEngine, 0);
	};

	// The server's document is ready (now or after the session's changes): the engine starts
	// again on it
	function restartEngine() {
		if (!co.loading || !api.isDocumentLoadComplete)
			return;
		co.loading = false;
		// The engine starts by leaving the silent mode docbuilder's load leaves documents in
		api.asc_SetSilentMode(true);
		window["eoStartEngine"]();
		co.reloaded = true;
	}

	// Joins the session of the editor configuration the integration made (JSON: document,
	// editorConfig, token, ...)
	engine["coOpen"] = function (json) {
		var config = JSON.parse(json);
		var documentConfig = config["document"] || {};
		var editorConfig = config["editorConfig"] || {};
		var userConfig = editorConfig["user"] || {};
		var user = new Asc.asc_CUserInfo();
		user.put_Id(userConfig["id"]);
		user.put_FullName(userConfig["name"]);
		var info = new Asc.asc_CDocInfo();
		info.put_Id(documentConfig["key"]);
		info.put_Url(documentConfig["url"]);
		info.put_Title(documentConfig["title"]);
		info.put_Format(documentConfig["fileType"]);
		info.put_Token(config["token"]);
		info.put_Permissions(documentConfig["permissions"] || {});
		info.put_CallbackUrl(editorConfig["callbackUrl"]);
		info.put_Mode(editorConfig["mode"]);
		info.put_UserInfo(user);
		// Fast unless the integration says otherwise, as in web-apps (the connector leaves it out
		// for viewers, who get the others' changes only in fast co-editing)
		if (info.put_CoEditingMode)
			info.put_CoEditingMode((editorConfig["coEditing"] && editorConfig["coEditing"]["mode"]) || "fast");
		api.asc_setDocInfo(info);
		// After the server's license the document is opened, as web-apps does (once: the
		// permissions may come again, and each load starts an action that blocks saving)
		// (spreadsheets: sdkjs loads it itself, when connected)
		var loading = false;
		var loadDocument = api.asc_LoadDocument;
		api.asc_LoadDocument = function () {
			loading = true;
			return loadDocument.apply(this, arguments);
		};
		api.asc_registerCallback("asc_onGetEditorPermissions", function () {
			if (!loading)
				api.asc_LoadDocument();
		});
		// After sdkjs finished: it leaves its silent mode after this event, which the engine's
		// start leaves too (layout would stay off)
		api.asc_registerCallback("asc_onDocumentContentReady", function () {
			window.setTimeout(restartEngine, 0);
		});
		// Who else is in the session
		function participants(users) {
			var me = api.CoAuthoringApi.getUserConnectionId();
			co.participants = Object.keys(users || {}).map(function (id) {
				var user = users[id];
				return { "id": user.asc_getId(), "name": user.asc_getUserName(), "color": user.asc_getColor(),
					"view": !!user.asc_getView(), "me": user.asc_getId() === me };
			});
		}
		api.asc_registerCallback("asc_onAuthParticipantsChanged", participants);
		api.asc_registerCallback("asc_onParticipantsChanged", participants);
		// The connection: sdkjs blocks editing while it reconnects, and turns to viewing when it
		// can't (asc_onCoAuthoringDisconnect)
		api.asc_registerCallback("asc_onStartAction", function (type, id) {
			if (id === Asc.c_oAscAsyncAction.Disconnect)
				co.reconnecting = true;
		});
		api.asc_registerCallback("asc_onEndAction", function (type, id) {
			if (id === Asc.c_oAscAsyncAction.Disconnect)
				co.reconnecting = false;
		});
		api.asc_registerCallback("asc_onCoAuthoringDisconnect", function () {
			co.disconnected = true;
			co.reconnecting = false;
		});
		// Changes go to the others at once (fast co-editing), sent each second
		api.asc_SetFastCollaborative(true);
		api.asc_setAutoSaveGap(1);
		// Someone who may only view joins as a viewer, as in web-apps: sdkjs applies the others'
		// changes as they come (live viewer) and edits nothing
		co.viewing = editorConfig["mode"] === "view";
		// The PDF editor isn't in view mode for viewers (they fill forms in), as in web-apps
		if (co.viewing && api.isPdfEditor && api.isPdfEditor())
			api.asc_setPdfViewer(true);
		else if (co.viewing)
			api.asc_setViewMode(true);
		// The real client (in docbuilder sdkjs would work offline)
		api.CoAuthoringApi.set_url(null);
		api._coAuthoringInit();
	};

	// What sdkjs does on its 40 ms interval in the web editor (sending changes, unlocking); the
	// app calls it on a timer while co-editing
	engine["coTick"] = function () {
		if (api.isDocumentLoadComplete)
			api._autoSave();
	};
	// Before leaving the session: the changes not sent yet go now, not when sdkjs would send them
	// (a second or two after the last one). True while some still wait for the server's answer;
	// the app asks again (carrying the outbox) until none do
	engine["coFlush"] = function () {
		if (!api.isDocumentLoadComplete || !co.socket)
			return false;
		if (api.canSave && api._haveChanges())
			api.asc_Save(true);
		return !api.canSave || api._haveChanges();
	};

	// What sdkjs sends, as JSON: [{type: "connect", options} | {type: "emit", name, data} |
	// {type: "disconnect"} | {type: "auth", auth: {token, session}} (new tokens for reconnecting) |
	// {type: "reconnection", name: "attempts" | "delay" | "delayMax", value} |
	// {type: "fetch", url, name} (a picture to download into the images directory)]
	engine["coTakeOutbox"] = function () {
		// sdkjs changes the tokens in the socket's options
		if (co.socket) {
			var tokens = authTokens(co.socket.options);
			if (tokens !== co.sentAuth) {
				co.sentAuth = tokens;
				co.outbox.push({ "type": "auth", "auth": JSON.parse(tokens) });
			}
		}
		if (co.locksChanged) {
			co.locksChanged = false;
			if (co.repaint)
				co.repaint();
		}
		var messages = co.outbox;
		co.outbox = [];
		return JSON.stringify(messages);
	};

	// An event of the socket (connect, message, disconnect, connect_error) or of its manager
	// (reconnect_failed), with its arguments as a JSON array
	engine["coReceive"] = function (name, argsJson) {
		var socket = co.socket;
		if (!socket)
			return;
		var args = argsJson ? JSON.parse(argsJson) : [];
		if (name === "reconnect_failed")
			socket.fire(socket.managerEvents, name, args);
		else
			socket.fire(socket.events, name, args);
		if (name === "message" && co.repaintOnMessages && co.repaint && args[0] && args[0]["type"] !== "cursor")
			co.repaint();
	};

	// A file the app downloaded for a URL of the server
	engine["coSetFile"] = function (url, path) {
		co.files[url] = path;
	};

	// Whether the engine started again on the server's document since the last call: the app
	// reads pages and sets languages, translations and the like again
	engine["coTakeReloaded"] = function () {
		var reloaded = !!co.reloaded;
		co.reloaded = false;
		return reloaded;
	};

	// A picture the app downloaded (a fetch of coTakeOutbox) is in the images directory
	engine["coImageLoaded"] = function (name) {
		if (co.repaint)
			co.repaint();
	};

	// Where the app uploads a picture to insert (JSON: {url, token}): the server answers with
	// its name in the document and URL ({"media/name.png": url}), for coAddUrls; then the
	// picture is inserted by that name (insertImage)
	engine["coUploadInfo"] = function () {
		return JSON.stringify({ "documentId": api.documentId, "token": api.CoAuthoringApi.get_jwt() });
	};

	engine["coAddUrls"] = function (json) {
		AscCommon.g_oDocumentUrls.addUrls(JSON.parse(json));
	};

	engine["coState"] = function () {
		return JSON.stringify(engine["coEditingState"]());
	};

	// The session for the app's view: state (sdkjs' ConnectionState), whether it reconnects or
	// has ended (disconnected: sdkjs turned to viewing), the participants ({id, name, color,
	// view, me}) and others' cursors ({user, name, color, page, x1, y1, x2, y2}); null without one
	engine["coEditingState"] = function () {
		var coApi = api.CoAuthoringApi && api.CoAuthoringApi._CoAuthoringApi;
		if (!co.socket)
			return null;
		// sdkjs moves others' cursors after changes when it draws a page
		var collaborative = AscCommon.CollaborativeEditing;
		if (Object.keys(co.cursors).length && collaborative && collaborative.Update_ForeignCursorsPositions)
			collaborative.Update_ForeignCursorsPositions();
		var colors = {};
		co.participants.forEach(function (user) { colors[user.id] = user; });
		var cursors = Object.keys(co.cursors).map(function (id) {
			var cursor = co.cursors[id];
			var user = colors[id];
			return {
				"user": id, "name": user ? user.name : "", "page": cursor.page,
				"color": user ? user.color : "#" + ("000000" + AscCommon.getUserColorById(cursor.shortId, null, true, true).toString(16)).substr(-6),
				"x1": cursor.x1, "y1": cursor.y1, "x2": cursor.x2, "y2": cursor.y2
			};
		});
		return {
			"state": coApi ? coApi.get_state() : -1,
			"reconnecting": co.reconnecting,
			"disconnected": co.disconnected,
			"participants": co.participants,
			"cursors": cursors,
			"selections": foreignSelections(colors)
		};
	};

	// Spreadsheets: the cells others selected on the active sheet ({user, name, color, editing,
	// ranges: [[c1, r1, c2, r2]]}), which the web editor frames in their color
	function foreignSelections(users) {
		var collaborative = isSpreadsheet && api.collaborativeEditing;
		if (!collaborative || !api.wbModel)
			return [];
		var sheetId = api.wbModel.getActiveWs().getId();
		var data = collaborative.m_aForeignCursorsData;
		return Object.keys(data).filter(function (id) {
			return data[id] && data[id].sheetId === sheetId && data[id].ranges;
		}).map(function (id) {
			var selection = data[id];
			var user = users[id];
			return {
				"user": id, "name": user ? user.name : "", "editing": !!selection.isEdit,
				"color": user ? user.color : "#" + ("000000" + AscCommon.getUserColorById(selection.shortId, null, true, true).toString(16)).substr(-6),
				"ranges": selection.ranges.map(function (range) { return [range.c1, range.r1, range.c2, range.r2]; })
			};
		});
	}
}

// Starts the engine on sdkjs' current document (again after co-editing loaded the server's)
window["eoStartEngine"] = function () {
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
		// Nor is there an animation pane; the web editor's would keep the first document's
		// slides when co-editing loads the server's version
		api.WordControl.m_oAnimPaneApi = null;
		// The page fits its zoom after layout, drawing the slide on its canvas (which fails
		// when co-editing loads the server's version); the engine draws slides itself
		api.WordControl.CalculateDocumentSize = function () {};
		api.WordControl.GoToPage = function (slide) {
			if (slide < 0 || slide >= logicDocument.GetSlidesCount())
				return;
			drawingDocument.SlideCurrent = slide;
			logicDocument.Set_CurPage(slide);
		};
		api.WordControl.GetSlidesCount = function () { return logicDocument.GetSlidesCount(); };
		api.WordControl.onNextPage = function () { api.WordControl.GoToPage(logicDocument.CurPage + 1); };
		api.WordControl.onPrevPage = function () { api.WordControl.GoToPage(logicDocument.CurPage - 1); };
		// The app scrolls to the cursor itself. The web editor's view scrolls there and moves its
		// cursor element after each paint; without scroll bars that threw, and as the paint never
		// ended, then every update of the cursor, applying others' changes too
		Object.defineProperty(drawingDocument, "UpdateTargetFromPaint", { get: function () { return false; }, set: function () {} });
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
	coEditingCommands(engine, api, allPagesChanged);
	// Texts sdkjs puts into documents (table of contents, headers, placeholders), by their English text
	engine["setTranslations"] = function (map) {
		AscCommon.translateManager.init(map);
	};

	// Graphics object for the next tile; the engine attaches its pixel buffer before drawTile()
	engine["tile"] = null;

	engine["getPageCount"] = function () {
		return editor.pageCount();
	};

	engine["getPageWidth"] = function (page) {
		return page < 0 ? previews.size(-1 - page)[0] : editor.pageWidth(page);
	};

	engine["getPageHeight"] = function (page) {
		return page < 0 ? previews.size(-1 - page)[1] : editor.pageHeight(page);
	};

	engine["beginTile"] = function () {
		engine["tile"] = new AscCommon.CNativeGraphics();
	};

	// Draws the area (x, y, width, height) of a page rendered at pageWidth x pageHeight pixels
	var previewKinds = {};
	var previews = previewCommands(engine, resources, previewKinds);

	engine["drawTile"] = function (page, pageWidth, pageHeight, x, y, width, height) {
		if (page < 0)
			return previews.draw(-1 - page, pageWidth, pageHeight, x, y, width, height);
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
		"mobileView": false,   // documents: laid out for the screen (setMobileView)
		"navigate": null,      // {page, y}: a place to show (setMobileView keeps one in view), reported once
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

		state["drawings"] = drawingStates(editor.selectedDrawings(), editor.drawingController(), isPresentation);
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

	// Text formatting of the selected pictures, shapes and charts (not of text in them): bold, sizes
	// and colors go to their text, but sdkjs reports it only for paragraphs (UpdateTextPr)
	function drawingTextPr() {
		if (editor.selectedDrawings().length === 0)
			return null;
		var controller = editor.drawingController();
		return controller && controller.getParagraphTextPr ? controller.getParagraphTextPr() || null : null;
	}

	// State as JSON; pages to draw again and layout changes are reported once
	engine["getState"] = function () {
		updateSelection();
		var textPr = drawingTextPr();
		if (textPr) {
			state["interface"]["Bold"] = !!textPr.Bold;
			state["interface"]["Italic"] = !!textPr.Italic;
			state["interface"]["Underline"] = !!textPr.Underline;
		}
		state["modified"] = api.isDocumentModified();
		state["layoutPending"] = isLayoutPending();
		state["currentPage"] = isPresentation ? logicDocument.CurPage : -1;
		state["mobileView"] = !!mobileView;
		try {
			state["format"] = formatState();
		} catch (e) {
			state["format"] = {};
		}
		try {
			// Presentations: only whether the cursor is in a table
			state["structure"] = isPresentation ? { "inTable": !!selectedElement(Asc.c_oAscTypeSelectElement.Table) } : structureState();
		} catch (e) {
			state["structure"] = null;
		}
		try {
			state["forms"] = isPresentation ? null : formState();
		} catch (e) {
			state["forms"] = null;
		}
		try {
			state["chart"] = engine["chartState"]();
		} catch (e) {
			state["chart"] = null;
		}
		try {
			state["spelling"] = engine["spellState"]();
		} catch (e) {
			state["spelling"] = null;
		}
		try {
			state["link"] = linkAtCursor();
		} catch (e) {
			state["link"] = null;
		}
		state["coEditing"] = engine["coEditingState"]();
		var result = JSON.stringify(state);
		state["dirtyPages"] = {};
		state["layoutChanged"] = false;
		state["error"] = null;
		state["openUrl"] = null;
		state["shownComments"] = [];
		state["navigate"] = null;
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
	// extend: like Shift+click, extends the selection to the point
	engine["mouse"] = function (type, page, x, y, clickCount, addToSelection, extend) {
		engine["finishComposingText"]();
		var e = mouseEvent(type, clickCount, addToSelection, extend);
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
	// A tap on a chart also selects the part of it under the finger (legend, title, ...), which
	// Delete, Backspace, copy and cut would take instead: they take the chart, unless its text
	// is edited
	function selectWholeChart() {
		var controller = editor.drawingController();
		var chart = controller && controller.selection && controller.selection.chartSelection;
		if (!chart || chart.selection.textSelection)
			return;
		chart.resetSelection();
		controller.selection.chartSelection = null;
	}

	engine["keyDown"] = function (keyCode, shift, ctrl) {
		// Keyboards may send keys (Enter) while composing a word: the word stays where it is,
		// later words are composed where the cursor is then
		engine["finishComposingText"]();
		if (keyCode === 8 || keyCode === 46)
			selectWholeChart();
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
		selectWholeChart();
		var data = {};
		api.asc_CheckCopy({
			"pushData": function (format, value) {
				data[format] = value;
			}
		}, clipboardFormat.Text | clipboardFormat.Internal);
		// Documents copy the internal format as {sBase64, text, drawingUrls}, presentations as a string
		var internal = data[clipboardFormat.Internal];
		return JSON.stringify({
			"text": data[clipboardFormat.Text] || "",
			"internal": (internal && internal.sBase64) || (typeof internal === "string" ? internal : "")
		});
	};

	engine["cut"] = function () {
		selectWholeChart();
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
		var textPr = drawingTextPr() || (logicDocument.GetCalculatedTextPr ? logicDocument.GetCalculatedTextPr() : null);
		var paraPr = logicDocument.GetCalculatedParaPr ? logicDocument.GetCalculatedParaPr() : null;
		var result = {};
		if (textPr) {
			var theme = isPresentation ? logicDocument.Get_Theme() : logicDocument.GetTheme();
			result["FontName"] = themeFontName(theme, textPr.FontFamily ? textPr.FontFamily.Name : "");
			result["FontSize"] = textPr.FontSize || 0;
			result["Strikeout"] = !!textPr.Strikeout;
			result["VertAlign"] = textPr.VertAlign || 0;
			var color = textPr.Color;
			if (textPr.Unifill && textPr.Unifill.fill && textPr.Unifill.fill.color) {
				// Theme colors as the color scheme has them now
				textPr.Unifill.check(theme, logicDocument.Get_ColorMap());
				color = textPr.Unifill.fill.color.RGBA;
			}
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
			result["List"] = api.asc_GetCurrentNumberingId && api.asc_GetCurrentNumberingId() !== null ? (paraPr && paraPr.NumPr ? 1 : 0) : -1;
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
	// A color (see ascColor), or "" for automatic
	engine["setTextColor"] = function (hex) {
		if (hex) {
			api.put_TextColor(ascColor(hex));
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
	// Fonts the document uses (its text, styles and theme)
	engine["getDocumentFonts"] = function () {
		var used = typeof logicDocument.Document_Get_AllFontNames === "function" ? logicDocument.Document_Get_AllFontNames() : {};
		return JSON.stringify(documentFonts(Object.keys(used)));
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

	// styleId: a table style's id (previews("tableStyles")), or the default style
	engine["insertTable"] = function (cols, rows, styleId) {
		if (isPresentation)
			api.put_Table(cols, rows, undefined, styleId || undefined);
		else
			api.put_Table(cols, rows, styleId || undefined);
	};
	engine["setTableStyle"] = function (styleId) {
		var properties = new Asc.CTableProp();
		properties.put_TableStyle(styleId);
		api.tblApply(properties);
	};
	// Pictures of the table styles, a table of 5 x 5 cells as the web editor shows them
	previewKinds["tableStyles"] = function () {
		var generator = new AscCommon.CTableStylesPreviewGenerator(logicDocument);
		generator.TableLook = logicDocument.GetDrawingDocument().GetTableLook(true);
		return logicDocument.GetAllTableStyles().map(function (style) {
			return {
				id: style.GetId(), name: style.GetName(), width: 297, height: 210,
				draw: function (g) { generator.DrawTable(g, generator.GetTable(style)); }
			};
		});
	};
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

	colorSchemeCommands(engine, api, allPagesChanged);
	// Presentations: the slides' size in mm
	engine["getSlideSize"] = function () {
		return JSON.stringify({ "width": api.get_PresentationWidth() / 36000, "height": api.get_PresentationHeight() / 36000 });
	};
	// 16:9 or 4:3, the height kept, as web-apps changes it
	engine["setSlideSize"] = function (wide) {
		var height = api.get_PresentationHeight();
		api.changeSlideSize(height * (wide ? 16 / 9 : 4 / 3), height, wide ? Asc.c_oAscSlideSZType.SzCustom : Asc.c_oAscSlideSZType.SzScreen4x3);
		allPagesChanged();
	};

	engine["addFootnote"] = function () { api.asc_AddFootnote(); };
	engine["addEndnote"] = function () { api.asc_AddEndnote(); };
	// From a note back to its reference in the text
	engine["endNoteEditing"] = function () {
		var endnote = api.asc_IsCursorInEndnote();
		var note = endnote ? logicDocument.Endnotes.GetCurEndnote() : logicDocument.Footnotes.GetCurFootnote();
		var ref = note && note.GetRef();
		if (endnote)
			logicDocument.EndEndnotesEditing();
		else
			logicDocument.EndFootnotesEditing();
		// sdkjs leaves the cursor at the document's start
		var run = ref && ref.GetRun();
		if (run && run.IsUseInDocument()) {
			run.State.ContentPos = run.Content.indexOf(ref) + 1;
			run.Make_ThisElementCurrent(true);
		}
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
			// Not the screen's pages of mobile view
			"pages": mobileView ? -1 : statistics.Pages, "words": statistics.Words, "paragraphs": statistics.Paragraphs,
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

	// ---------------------------------------------------------------------------------
	// Forms (content controls of docxf, oform and PDF forms)

	// Filling: only form fields take input; role: only that role's fields ("" for all)
	engine["setFillMode"] = function (fill, role) {
		if (!fill) {
			api.asc_setRestriction(Asc.c_oAscRestrictionType.None);
			return;
		}
		// Without a role, the form's first (usually "Anyone"): fields of other roles can't be filled
		var settings = new AscCommon.CRestrictionSettings();
		var roles = JSON.parse(engine["getFormRoles"]());
		var name = role || (roles.length ? roles[0]["name"] : "");
		if (name)
			settings.put_OFormRole(name);
		api.asc_setRestriction(Asc.c_oAscRestrictionType.OnlyForms, settings);
		allPagesChanged();
	};

	// Asc.c_oAscContentControlSpecificType as names
	function formType(form) {
		if (form.IsCheckBox && form.IsCheckBox())
			return form.IsRadioButton && form.IsRadioButton() ? "radio" : "checkBox";
		if (form.IsComboBox && form.IsComboBox())
			return "comboBox";
		if (form.IsDropDownList && form.IsDropDownList())
			return "dropDownList";
		if (form.IsPictureForm && form.IsPictureForm())
			return form.IsSignatureForm && form.IsSignatureForm() ? "signature" : "picture";
		if (form.IsDatePicker && form.IsDatePicker())
			return "date";
		if (form.IsComplexForm && form.IsComplexForm())
			return "complex";
		return "text";
	}

	function formJson(form) {
		var type = formType(form);
		var bounds = form.GetBoundingRect ? form.GetBoundingRect() : null;
		var result = {
			"id": form.GetId(), "key": form.GetFormKey ? form.GetFormKey() || "" : "", "type": type,
			"placeholder": form.GetPlaceholderText ? form.GetPlaceholderText() || "" : "",
			"required": !!(form.IsFormRequired && form.IsFormRequired()),
			"empty": !!(form.IsPlaceHolder && form.IsPlaceHolder()),
			"text": form.IsPlaceHolder && form.IsPlaceHolder() ? "" : (form.GetInnerText ? form.GetInnerText() || "" : ""),
			"role": form.GetFormRole ? form.GetFormRole() || "" : "",
			"help": form.GetFormPr && form.GetFormPr() && form.GetFormPr().GetHelpText ? form.GetFormPr().GetHelpText() || "" : "",
			"page": bounds && !bounds.Invalid ? bounds.Page : -1,
			"x": bounds ? bounds.X : 0, "y": bounds ? bounds.Y : 0, "width": bounds ? bounds.W : 0, "height": bounds ? bounds.H : 0
		};
		if (type === "checkBox" || type === "radio") {
			result["checked"] = !!form.IsCheckBoxChecked();
			result["group"] = form.GetCheckBoxPr && form.GetCheckBoxPr().GetGroupKey ? form.GetCheckBoxPr().GetGroupKey() || "" : "";
		}
		if (type === "comboBox" || type === "dropDownList") {
			var list = type === "comboBox" ? form.GetComboBoxPr() : form.GetDropDownListPr();
			var items = [];
			for (var i = 0; list && i < list.GetItemsCount(); i++)
				items.push({ "text": list.GetItemDisplayText(i) || "", "value": list.GetItemValue(i) || "" });
			result["items"] = items;
		}
		if (type === "date") {
			var date = form.GetDatePickerPr();
			result["dateFormat"] = date && date.GetDateFormat ? date.GetDateFormat() || "" : "";
		}
		return result;
	}

	// All fields in document order
	engine["getForms"] = function () {
		var forms = logicDocument.GetFormsManager ? logicDocument.GetFormsManager().GetAllForms() : [];
		return JSON.stringify(forms.map(formJson));
	};

	// Text, checked (true/false), a list item's value, a date (ISO) or a picture (its name in the images directory)
	engine["setFormValue"] = function (id, type, value) {
		engine["finishComposingText"]();
		if (type === "text" || type === "complex") {
			// From inside the field: filling allows changes only there
			var control = AscCommon.g_oTableId.Get_ById(id);
			if (control) {
				logicDocument.RemoveSelection();
				control.MoveCursorToContentControl(true);
			}
			if (value)
				api.asc_SetContentControlText(value, id);
			else
				api.asc_ClearContentControl(id);
		} else if (type === "checkBox" || type === "radio") {
			api.asc_SetContentControlCheckBoxChecked(!!value, id);
		} else if (type === "comboBox" || type === "dropDownList") {
			api.asc_SelectContentControlListItem(value, id);
		} else if (type === "date") {
			var date = new AscCommon.CSdtDatePickerPr();
			date.put_FullDate(value);
			api.asc_SetContentControlDatePickerDate(date, id);
		} else if (type === "picture" || type === "signature") {
			preloadImage(api, value["name"], value["width"], value["height"]);
			api.asc_SetFormValue(value["name"], id);
		}
		allPagesChanged();
	};

	// next, previous, nextRequired, clear (all fields)
	engine["formAction"] = function (name) {
		engine["finishComposingText"]();
		if (name === "next" || name === "previous")
			api.asc_MoveToFillingForm(name === "next", false, false);
		else if (name === "nextRequired")
			api.asc_MoveToFillingForm(true, true, true);
		else if (name === "clear")
			api.asc_ClearAllSpecialForms();
		allPagesChanged();
	};

	// Roles of an oform: [{name, color "RRGGBB", fieldCount}]
	engine["getFormRoles"] = function () {
		var form = api.asc_GetOForm ? api.asc_GetOForm() : null;
		var roles = form ? form.asc_getAllRoles() : [];
		return JSON.stringify(roles.map(function (role) {
			var settings = role.asc_getSettings();
			var color = settings.getAscColor();
			return {
				"name": settings.getName() || "",
				"color": color ? [color.asc_getR(), color.asc_getG(), color.asc_getB()].map(function (v) { return ("0" + v.toString(16)).slice(-2); }).join("") : "",
				"fieldCount": settings.getFieldCount ? settings.getFieldCount() : 0
			};
		}));
	};

	// The form at the cursor and whether required ones are filled
	function formState() {
		var id = api.asc_GetCurrentContentControl ? api.asc_GetCurrentContentControl() : null;
		var control = id ? AscCommon.g_oTableId.Get_ById(id) : null;
		var hasForms = logicDocument.GetFormsManager && logicDocument.GetFormsManager().GetAllForms().length > 0;
		if (!hasForms)
			return null;
		return {
			"current": control && control.IsForm && control.IsForm() ? formJson(control) : null,
			"filling": !!(api.isRestrictionForms && api.isRestrictionForms()),
			"allRequiredFilled": !!api.asc_IsAllRequiredFormsFilled()
		};
	}

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
	engine["pdfCommands"] = function () {
		// The document's pages, not the screen's
		var view = mobileView;
		if (view)
			engine["setMobileView"](false);
		try {
			// All pages laid out
			for (var i = 0; i < 10000 && isLayoutPending(); ++i)
				runTimers(100);
			return pdfCommands(api);
		} finally {
			if (view)
				engine["setMobileView"](true, view.width, view.height, view.scale);
		}
	};

	// Mobile view (documents): the text laid out again on pages of the screen's width (mm), its
	// letters scaled by scale, without headers and footers, as ONLYOFFICE's mobile editors do it
	// (sdkjs' read layout). Only the view changes: the document, saving, the changes sent to
	// others are the same; PDFs (and printing) have the document's pages.
	// The text at (page, x, y) before, if given, is where it is afterwards: state's navigate.
	var mobileView = null;
	engine["setMobileView"] = function (on, width, height, scale, page, x, y) {
		if (isPresentation)
			return;
		var place = page === undefined || page < 0 ? null : logicDocument.Get_NearestPos(page, x, y, true);
		if (on) {
			mobileView = { width: width, height: height, scale: scale };
			logicDocument.SetDocumentReadMode(width, height, scale);
		} else if (mobileView) {
			mobileView = null;
			logicDocument.SetDocumentPrintMode();
		}
		state["layoutChanged"] = true;
		allPagesChanged();
		if (place && place.Paragraph && place.ContentPos) {
			// Laid out that far (the whole document, unless it takes long)
			for (var end = Date.now() + 2000; isLayoutPending() && Date.now() < end;)
				runTimers(100);
			var moved = place.Paragraph.Get_XYByContentPos(place.ContentPos);
			if (moved && typeof moved.PageNum === "number")
				state["navigate"] = { "page": moved.PageNum, "y": moved.Y };
		}
	};

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

	// A text box taking the typing. Presentations: centered on (x, y) of the slide (mm), 60 % of
	// its width, its height fitting its text (sdkjs adds shapes at a place and size of its own,
	// small and mostly over the title); documents: as sdkjs adds it at the cursor
	engine["insertTextBox"] = function (page, x, y) {
		if (!isPresentation) {
			engine["insertShape"]("textRect");
			return;
		}
		engine["finishComposingText"]();
		api.AddShapeOnCurrentPage("textRect");
		var width = logicDocument.GetWidthMM() * 0.6, height = 20;
		if (page !== logicDocument.CurPage) {
			x = logicDocument.GetWidthMM() / 2;
			y = logicDocument.GetHeightMM() / 2;
		}
		var properties = new Asc.asc_CImgProperty();
		properties.asc_putWidth(width);
		properties.asc_putHeight(height);
		properties.asc_putPosition(new Asc.CPosition({ "X": x - width / 2, "Y": y - height / 2 }));
		api.ImgApply(properties);
		state["dirtyPages"][logicDocument.CurPage] = true;
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

	// Comments: [{id, text, user, time, quote, solved, replies, page, x, y}] (page -1: on the presentation)
	var commentUser = { "id": "", "name": "" };
	var CommentData = isPresentation ? Asc.asc_CCommentDataSlide : Asc.asc_CCommentDataWord;
	engine["setCommentUser"] = function (id, name) { commentUser = { "id": id, "name": name }; };
	function commentData(id) {
		if (!isPresentation) {
			var comment = logicDocument.Comments.Get_ById(id);
			return comment ? new CommentData(comment.GetData()) : null;
		}
		var found = logicDocument.GetAllComments().filter(function (item) { return item.comment.Get_Id() === id; })[0];
		return found ? new CommentData(found.comment.Data) : null;
	}
	engine["getComments"] = function () {
		var result = [];
		if (isPresentation) {
			logicDocument.GetAllComments().forEach(function (item) {
				result.push(commentJson(item.comment.Get_Id(), new CommentData(item.comment.Data),
					{ "page": item.slide ? logicDocument.Slides.indexOf(item.slide) : -1, "x": item.comment.x || 0, "y": item.comment.y || 0 }));
			});
		} else {
			var all = logicDocument.Comments.GetAllComments();
			for (var id in all) {
				var start = all[id].m_oStartInfo || {};
				result.push(commentJson(id, new CommentData(all[id].GetData()),
					{ "page": typeof start.PageNum === "number" ? start.PageNum : -1, "x": start.X || 0, "y": start.Y || 0 }));
			}
		}
		return JSON.stringify(result);
	};
	// On the selection (or the word at the cursor; in presentations the slide)
	engine["addComment"] = function (text) {
		engine["finishComposingText"]();
		var data = newCommentData(CommentData, commentUser, text);
		data.asc_putDocumentFlag(false);
		api.asc_addComment(data);
		allPagesChanged();
	};
	function changeComment(id, change) {
		var data = commentData(id);
		if (!data)
			return;
		change(data);
		api.asc_changeComment(id, data);
		allPagesChanged();
	}
	engine["replyComment"] = function (id, text) {
		changeComment(id, function (data) { data.asc_addReply(newCommentData(CommentData, commentUser, text)); });
	};
	engine["resolveComment"] = function (id, solved) {
		changeComment(id, function (data) { data.asc_putSolved(solved); });
	};
	engine["deleteComment"] = function (id) {
		api.asc_removeComment(id);
		allPagesChanged();
	};
	// Moves to the comment: its text in documents, its slide in presentations
	engine["gotoComment"] = function (id) {
		if (isPresentation)
			api.asc_showComment(id);
		else
			api.asc_selectComment(id);
		allPagesChanged();
	};
	// Commented text is highlighted
	if (!isPresentation)
		api.asc_showComments(true);
	// The comments sdkjs shows (a tap into commented text): their ids, reported once
	state["shownComments"] = [];
	api.asc_registerCallback("asc_onShowComment", function (ids) {
		state["shownComments"] = (ids || []).map(String);
	});

	chartCommands(engine, api, {
		selectedDrawings: function () { return editor.selectedDrawings(); },
		insert: function (type) {
			engine["finishComposingText"]();
			// false: without the web editor's chart data editor
			api.asc_addChartDrawingObject(type, undefined, false);
		},
		action: function (change) {
			logicDocument.StartAction(isPresentation ? AscDFH.historydescription_Presentation_EditChart : AscDFH.historydescription_Document_EditChart);
			change();
			logicDocument.FinalizeAction();
		},
		previews: previewKinds
	});
	["setChartType", "setChartElements", "setChartData", "setChartTitles", "setChartStyle", "setChartLayout", "setChartAxis"].forEach(function (name) {
		engine[name] = drawingCommand(engine[name]);
	});
	engine["drawingColors"] = function () { return drawingColorsJson(editor.selectedDrawings()); };

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
	// The selected objects, dragged off the current slide, go to [slide], whose top is
	// [offset] mm below the current slide's top in the app's layout: they keep their place
	// under the finger. As cut and paste, as sdkjs has no move between slides
	engine["moveToSlide"] = function (slide, offset) {
		var current = logicDocument.CurPage;
		if (slide === current || slide < 0 || slide >= logicDocument.GetSlidesCount())
			return;
		function selection() {
			var controller = logicDocument.GetCurrentController();
			return controller ? controller.getSelectedArray() : [];
		}
		function top(drawings) {
			return Math.min.apply(null, drawings.map(function (drawing) { return drawing.y; }));
		}
		function left(drawings) {
			return Math.min.apply(null, drawings.map(function (drawing) { return drawing.x; }));
		}
		var moved = selection();
		if (moved.length === 0)
			return;
		var x = left(moved), y = top(moved) - offset;
		var copied = JSON.parse(engine["copy"]())["internal"];
		if (!copied)
			return;
		api.asc_SelectionCut();
		engine["gotoSlide"](slide);
		api.asc_PasteData(AscCommon.c_oAscClipboardDataFormat.Internal, copied);
		// Pasted where they were on their slide: moved to where they were dropped
		var pasted = selection();
		if (pasted.length === 0)
			return;
		var dx = x - left(pasted), dy = y - top(pasted);
		logicDocument.StartAction(AscDFH.historydescription_CommonDrawings_EndTrack);
		pasted.forEach(function (drawing) {
			AscFormat.CheckSpPrXfrm(drawing);
			var xfrm = drawing.spPr.xfrm;
			xfrm.setOffX(xfrm.offX + dx);
			xfrm.setOffY(xfrm.offY + dy);
		});
		logicDocument.Recalculate();
		logicDocument.FinalizeAction();
		allPagesChanged();
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
	// Pictures of the layouts (getLayouts), as the web editor shows them: background, the
	// master's shapes and the placeholders' frames
	previewKinds["layouts"] = function () {
		var all = logicDocument.GetAllLayouts();
		var master = logicDocument.getLayoutsMasterSlide ? logicDocument.getLayoutsMasterSlide() : null;
		var width = logicDocument.GetWidthMM(), height = logicDocument.GetHeightMM();
		return (master ? master.sldLayoutLst : all).map(function (layout) {
			return {
				id: all.indexOf(layout), name: layout.getName() || "", width: width, height: height,
				draw: function (g) {
					layout.drawNoPlaceholders(g);
					// The placeholders' frames, without the dates, footers and numbers
					var skipped = [AscFormat.phType_dt, AscFormat.phType_ftr, AscFormat.phType_hdr, AscFormat.phType_sldNum];
					layout.cSld.spTree.forEach(function (shape) {
						if (!shape.isPlaceholder || !shape.isPlaceholder() || AscCommon.IsHiddenObj(shape) ||
							skipped.indexOf(shape.getPlaceholderType()) >= 0 || !shape.transform)
							return;
						var m = shape.transform;
						var corners = [[0, 0], [shape.extX, 0], [shape.extX, shape.extY], [0, shape.extY]];
						g.p_width(2500);
						g.p_color(128, 128, 128, 255);
						g._s();
						corners.forEach(function (c, i) {
							var x = m.TransformPointX(c[0], c[1]), y = m.TransformPointY(c[0], c[1]);
							if (i === 0) g._m(x, y); else g._l(x, y);
						});
						g._z();
						g.ds();
						g._e();
					});
				}
			};
		});
	};
	// Designs (sdkjs' themes): the ones Document::PrepareThemes converted, themeN/theme.bin in
	// sdkjs' slide/themes, by their files' names ("05_green leaf"). sdkjs' theme loader loads them
	// over the web; here they are read from there.
	var themes = [];
	var THEME_NAMES = { "tort": "Turtle" };
	engine["setThemes"] = function (files) {
		var loader = api.ThemeLoader;
		var directory = window["native"]["GetFontsDirectory"]() + "/../slide/themes/";
		themes = files.map(function (file) {
			var name = file.replace(/^\d+_/, "");
			return THEME_NAMES[name] || name.charAt(0).toUpperCase() + name.slice(1);
		});
		loader.ThemesUrl = directory;
		loader.Themes.EditorThemes = themes.map(function (name, i) { return { Name: name, Index: i }; });
		loader.themes_info_editor = themes.map(function () { return null; });
		loader.ThemesCached = [];
		loader.LoadThemeJSAsync = function (src) {
			this._callback_theme_load(window["native"]["GetFileBinary"](src));
		};
	};
	// The design of all slides (index in previews("themes")), in one undo step
	engine["setTheme"] = function (index) {
		if (index < 0 || index >= themes.length)
			return;
		api.ChangeTheme(index, false);
		// Its pictures are drawn from the designs' directory (Document's TileImage)
		var info = api.ThemeLoader.themes_info_editor[index];
		var images = info && info.ImageMap ? info.ImageMap : {};
		Object.keys(images).forEach(function (key) {
			if (!api.ImageLoader.map_image_index[images[key]])
				preloadImage(api, images[key], 1, 1);
		});
		allPagesChanged();
	};
	// Pictures of the designs: their title slide's layout with its texts
	previewKinds["themes"] = function () {
		return themes.map(function (name, index) {
			var master = themeMaster(index);
			var layout = master && (master.sldLayoutLst[0] || null);
			var width = logicDocument.GetWidthMM(), height = logicDocument.GetHeightMM();
			return {
				id: index, name: name, width: width, height: height,
				draw: function (g) {
					if (!layout)
						return;
					// At the presentation's size
					g.transform(width / layout.Width, 0, 0, height / layout.Height, 0, 0);
					layout.draw(g);
				}
			};
		});
	};
	// A design's master, read from its file once (as sdkjs' theme loader reads it)
	var themeMasters = [];
	function themeMaster(index) {
		if (themeMasters[index] !== undefined)
			return themeMasters[index];
		var loader = api.ThemeLoader;
		var current = loader.CurrentLoadThemeIndex;
		var master = null;
		try {
			var binary = loader.ThemesCached[index] = loader.ThemesCached[index] ||
				window["native"]["GetFileBinary"](loader.ThemesUrl + "theme" + (index + 1) + "/theme.bin");
			var reader = new AscCommon.BinaryPPTYLoader();
			reader.Api = api;
			reader.IsThemeLoader = true;
			var presentation = {
				setSldSz: function (size) { this.sldSz = size; },
				GetWidthEMU: AscCommonSlide.CPresentation.prototype.GetWidthEMU,
				GetHeightEMU: AscCommonSlide.CPresentation.prototype.GetHeightEMU,
				GetWidthMM: AscCommonSlide.CPresentation.prototype.GetWidthMM,
				GetHeightMM: AscCommonSlide.CPresentation.prototype.GetHeightMM,
				slideMasters: [], DrawingDocument: api.WordControl.m_oDrawingDocument, CommentAuthors: {}
			};
			loader.CurrentLoadThemeIndex = index;
			AscCommon.History.MinorChanges = true;
			AscFormat.ExecuteNoHistory(function () { reader.Load(binary, presentation); }, this, []);
			master = presentation.slideMasters[0] || null;
			var images = loader.themes_info_editor[index] && loader.themes_info_editor[index].ImageMap || {};
			Object.keys(images).forEach(function (key) {
				if (!api.ImageLoader.map_image_index[images[key]])
					preloadImage(api, images[key], 1, 1);
			});
		} catch (e) {
			console.log("theme " + index + ": " + e);
		} finally {
			AscCommon.History.MinorChanges = false;
			loader.CurrentLoadThemeIndex = current;
		}
		themeMasters[index] = master;
		return master;
	}

	// The current slide's background: a color "RRGGBB"; getSlideBackground: its color, "" for
	// none, null for other fills (pictures, gradients, from the layout)
	engine["setSlideBackground"] = function (hex) {
		var properties = new Asc.CAscSlideProps();
		properties.put_background(shapeFill(hex).asc_getFill());
		api.SetSlideProps(properties);
		allPagesChanged();
	};
	engine["getSlideBackground"] = function () {
		var slide = logicDocument.Slides[logicDocument.CurPage];
		return JSON.stringify(slide && slide.backgroundFill ? uniFillHex(slide.backgroundFill) : null);
	};
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

	// Spell checking. sdkjs asks for words to be checked through SpellCheckApi; the requests are
	// queued here and answered by the app (Hunspell) with spellResults. Languages are sdkjs'
	// LCIDs; those without a dictionary are collected in "missing" for the app to download.
	var spelling = { languages: {}, missing: {}, queue: [], property: null };
	api.SpellCheckApi = {
		checkDictionary: function (lang) {
			if (spelling.languages[lang])
				return true;
			spelling.missing[lang] = true;
			return false;
		},
		spellCheck: function (data) { spelling.queue.push(data); },
		disconnect: function () {},
		restart: function () { spelling.queue = []; },
		// The server's spell checker isn't used (co-editing)
		init: function () {},
		set_url: function () {}
	};
	api.isSpellCheckEnable = true;
	// Turned off when the editor started without a spell checker (a counter: on at exactly 1)
	var spellChecker = logicDocument.GetSpellCheckManager ? logicDocument.GetSpellCheckManager() : logicDocument.Spelling;
	while (spellChecker && spellChecker.Active < 1)
		spellChecker.TurnOn();

	// The languages with a dictionary; checking starts again with them
	engine["setSpellLanguages"] = function (langs) {
		spelling.languages = {};
		langs.forEach(function (lang) {
			spelling.languages[lang] = true;
			delete spelling.missing[lang];
		});
		spelling.queue = [];
		if (api.asc_restartCheckSpelling)
			api.asc_restartCheckSpelling();
		continueSpellCheck();
	};

	engine["setSpellCheck"] = function (on) {
		api.asc_setSpellCheck(on);
		allPagesChanged();
	};

	function continueSpellCheck() {
		if (logicDocument.ContinueSpellCheck)
			logicDocument.ContinueSpellCheck();
	}

	// The queued requests, as JSON: [{type, usrWords, usrLang, ...}]
	engine["takeSpellRequests"] = function () {
		var requests = spelling.queue;
		spelling.queue = [];
		return JSON.stringify(requests);
	};

	// Answers to takeSpellRequests (the requests with usrCorrect or usrSuggest); the marks are
	// drawn again and the next paragraphs are checked
	engine["spellResults"] = function (json) {
		var suggested = false;
		JSON.parse(json).forEach(function (result) {
			api.SpellCheck_CallBack(result);
			suggested = suggested || result["type"] === "suggest";
		});
		// Suggestions for the word at the cursor reach the state through the interface state
		if (suggested)
			logicDocument.Document_UpdateInterfaceState();
		allPagesChanged();
		continueSpellCheck();
	};

	// The misspelled word at the cursor: {word, variants} (variants null while they are looked up)
	function spellingState() {
		spelling.property = selectedElement(Asc.c_oAscTypeSelectElement.SpellCheck);
		var property = spelling.property;
		if (!property)
			return null;
		var variants = property.get_Variants ? property.get_Variants() : property.Variants;
		return { "word": property.get_Word ? property.get_Word() : property.Word, "variants": variants || null };
	}

	engine["replaceMisspelled"] = function (variant) {
		if (spelling.property)
			api.asc_replaceMisspelledWord(variant, spelling.property);
	};

	// The word is not marked any more: here, or everywhere in the document
	engine["ignoreMisspelled"] = function (all) {
		if (spelling.property)
			api.asc_ignoreMisspelledWord(spelling.property, all);
		allPagesChanged();
	};

	// Text of a page for screen readers: paragraphs of documents (also in tables), text of the
	// shapes of a slide; each with its area in mm, as JSON [{text, left, top, right, bottom}]
	engine["textBlocks"] = function (page) {
		var blocks = [];
		function add(text, left, top, right, bottom) {
			text = text.replace(/[\r\n\t]+$/, "").replace(/\r\n?/g, "\n");
			if (text.trim())
				blocks.push({ "text": text, "left": left, "top": top, "right": right, "bottom": bottom });
		}
		function paragraphs(elements) {
			elements.forEach(function (element) {
				if (element.IsParagraph && element.IsParagraph()) {
					for (var i = 0; i < element.Pages.length; i++) {
						if (element.GetAbsolutePage(i) !== page)
							continue;
						var bounds = element.Pages[i].Bounds;
						add(element.GetText({ "Numbering": true }), bounds.Left, bounds.Top, bounds.Right, bounds.Bottom);
					}
				} else if (element.IsTable && element.IsTable()) {
					element.Content.forEach(function (row) {
						row.Content.forEach(function (cell) { paragraphs(cell.Content.Content); });
					});
				} else if (element.Content && element.Content.Content) {
					// Block content controls
					paragraphs(element.Content.Content);
				}
			});
		}
		function shapes(drawings) {
			drawings.forEach(function (drawing) {
				if (drawing.spTree) {
					shapes(drawing.spTree);
					return;
				}
				var content = drawing.getDocContent && drawing.getDocContent();
				var bounds = drawing.bounds;
				if (content && bounds)
					add(content.GetText({ "ParaSeparator": "\n" }), bounds.l, bounds.t, bounds.r, bounds.b);
			});
		}
		if (isPresentation) {
			var slide = logicDocument.Slides[page];
			if (slide)
				shapes(slide.cSld.spTree);
		} else {
			paragraphs(logicDocument.Content);
		}
		return JSON.stringify(blocks);
	};

	engine["spellState"] = function () {
		continueSpellCheck();
		return {
			"pending": spelling.queue.length > 0,
			"missing": Object.keys(spelling.missing).map(Number),
			"word": spellingState()
		};
	};
};
// PDFs start in pdf.js, which runs next (Document::OpenPdf)
if (!window["eoPdfFile"])
	window["eoStartEngine"]();

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
	coEditingCommands(engine, api, function () { changed = true; }, true);
	colorSchemeCommands(engine, api, function () { changed = true; });
	engine["tick"] = runTimers;
	// Texts sdkjs puts into documents (table of contents, headers, placeholders), by their English text
	engine["setTranslations"] = function (map) {
		AscCommon.translateManager.init(map);
	};
	var PX_TO_MM = 25.4 / 96;
	// Empty columns and rows shown after the used ones, to type into
	var EXTRA_COLS = 10, EXTRA_ROWS = 50, MIN_COLS = 26, MIN_ROWS = 100;

	api.asc_SetSilentMode(false);
	AscCommon.History.TurnOnChanges();
	// The sheet shown, as the web editor's page shows it (others learn the selection's sheet from it)
	if (api.wb.wsActive === -1)
		api.wb.wsActive = api.wbModel.getActive();
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
	engine["getPageWidth"] = function (page) { return page < 0 ? previews.size(-1 - page)[0] : geometry.cols[geometry.cols.length - 1]; };
	engine["getPageHeight"] = function (page) { return page < 0 ? previews.size(-1 - page)[1] : geometry.rows[geometry.rows.length - 1]; };
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

	var previewKinds = {};
	var previews = previewCommands(engine, resources, previewKinds);

	engine["drawTile"] = function (page, pageWidth, pageHeight, x, y, width, height) {
		if (page < 0)
			return previews.draw(-1 - page, pageWidth, pageHeight, x, y, width, height);
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
		pageData.pageGridLines = api.asc_getSheetViewSettings().asc_getShowGridLines();
		pageData.scale = 1;
		pageData.indexWorksheet = api.asc_getActiveWorksheetIndex();

		// Print pages start at the page's origin: move it to the first cell
		g.transform(1, 0, 0, 1, cols[c1], rows[r1]);
		g.BeginPage = g.EndPage = function () {};
		var printer = new AscCommonExcel.CPdfPrinter(api.wb.fmgrGraphics[3], api.wb.m_oFont.clone());
		printer.DocumentRenderer = g;
		// The sheet, not a printed page: without its header and footer
		var sheetView = view();
		sheetView.drawHeaderFooter = function () {};
		try {
			sheetView.drawForPrint(printer, pageData, 0, [pageData]);
		} finally {
			delete sheetView.drawHeaderFooter;
		}

		g.Native["Destroy"]();
		engine["tile"] = null;
	};

	// ---------------------------------------------------------------------------------
	// State and commands

	// The sheet is drawn again (also when co-editing starts the engine again)
	var changed = true;

	// The active sheet's gridlines, and its pages' orientation and size (mm, portrait) for printing
	engine["getSheetSetup"] = function () {
		var setup = api.asc_getPageOptions(api.asc_getActiveWorksheetIndex()).asc_getPageSetup();
		return JSON.stringify({
			"gridlines": api.asc_getSheetViewSettings().asc_getShowGridLines(),
			"landscape": setup.asc_getOrientation() === Asc.c_oAscPageOrientation.PageLandscape,
			"width": setup.asc_getWidth(), "height": setup.asc_getHeight()
		});
	};
	engine["setGridlines"] = function (show) {
		api.asc_setDisplayGridlines(show);
		changed = true;
	};
	engine["setSheetPage"] = function (setup) {
		var index = api.asc_getActiveWorksheetIndex();
		if (setup["landscape"] !== undefined)
			api.asc_changePageOrient(!setup["landscape"], index);
		if (setup["width"] !== undefined)
			api.asc_changeDocSize(Math.min(setup["width"], setup["height"]), Math.max(setup["width"], setup["height"]), index);
	};
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
		// A chart, picture or shape is selected: formatting goes to its text, not to the cells
		var textPr = view().isSelectOnShape ? drawingController().getParagraphTextPr() || null : null;
		sheet["cellFormat"] = cellFormat(textPr);
		var state = {
			"cursor": null, "selection": [], "drawings": drawingStates(selectedDrawings(), drawingController()),
			"dirtyPages": changed ? { "0": true } : {},
			"layoutChanged": geometryChanged,
			"layoutPending": false,
			"currentPage": -1,
			"modified": api.asc_isDocumentModified(),
			"error": lastError,
			"interface": {
				"Bold": textPr ? !!textPr.Bold : !!font.getBold(),
				"Italic": textPr ? !!textPr.Italic : !!font.getItalic(),
				"Underline": textPr ? !!textPr.Underline : font.getUnderline() !== Asc.EUnderline.underlineNone,
				"PrAlign": cell.getAlign().getAlignHorizontal(),
				"CanUndo": api.asc_getCanUndo(),
				"CanRedo": api.asc_getCanRedo()
			},
			"sheet": sheet,
			"search": search,
			"link": cellLink(),
			"chart": engine["chartState"](),
			"openUrl": openUrl,
			"coEditing": engine["coEditingState"]()
		};
		changed = false;
		geometryChanged = false;
		lastError = null;
		openUrl = null;
		return JSON.stringify(state);
	};

	chartCommands(engine, api, {
		selectedDrawings: selectedDrawings,
		sheet: {
			// The selected cells, as a chart's range
			selectedRange: function () {
				var sheet = view().model;
				return AscCommon.parserHelp.get3DRef(sheet.getName(), sheet.selectionRange.getLast().getAbsName());
			},
			deselect: function () {
				drawingController().resetSelection();
				view().setSelectionShape(false);
			},
			select: function (drawing) {
				var controller = drawingController();
				controller.resetSelection();
				controller.selectObject(drawing, 0);
				view().setSelectionShape(true);
			}
		},
		insert: function (type) {
			// From the selected cells; for one cell, the table of filled cells around it, as in Excel
			var selected = view().model.selectionRange.getLast();
			if (selected.isOneCell()) {
				var around = view().model.autoFilters._getAdjacentCellsAF(selected);
				if (around && !around.isOneCell())
					view().setSelection(around);
			}
			var settings = api.asc_getChartSettings(true);
			settings.putType(type);
			api.asc_addChartDrawingObject(settings);
		},
		// One undo step, once the chart is locked
		action: function (change) {
			drawingController().checkSelectedObjectsAndCallback(change, [], false, AscDFH.historydescription_Spreadsheet_EditChart);
		},
		previews: previewKinds
	});
	["insertChart", "setChartType", "setChartElements", "setChartTitles", "setChartRange", "switchChartRowCol", "startChartRange", "endChartRange",
		"setChartStyle", "setChartLayout", "setChartAxis"].forEach(function (name) {
		engine[name] = edit(engine[name]);
	});
	engine["drawingColors"] = function () { return drawingColorsJson(selectedDrawings()); };

	// Comments on cells: [{id, text, user, time, quote, solved, replies, sheet, col, row}]. While
	// co-editing they are locked on the server first (sdkjs changes them when it answers, and the
	// sheet is drawn again then); without a session sdkjs' lock would wait for one.
	function noLock() { return !(window["eoCoState"] && window["eoCoState"].socket); }
	var commentUser = { "id": "", "name": "" };
	engine["setCommentUser"] = function (id, name) { commentUser = { "id": id, "name": name }; };
	function sheetComment(id) {
		for (var i = 0; i < api.wb.model.getWorksheetCount(); i++) {
			var found = api.wb.model.getWorksheet(i).aComments.filter(function (comment) { return comment.asc_getId() === id; })[0];
			if (found)
				return { sheet: i, comment: found };
		}
		return null;
	}
	engine["getComments"] = function () {
		var result = [];
		for (var i = 0; i < api.wb.model.getWorksheetCount(); i++) {
			api.wb.model.getWorksheet(i).aComments.forEach(function (comment) {
				var place = { "sheet": i, "col": comment.asc_getCol(), "row": comment.asc_getRow() };
				var json = commentJson(comment.asc_getId(), comment, place);
				json["quote"] = new Asc.Range(place["col"], place["row"], place["col"], place["row"]).getName();
				result.push(json);
			});
		}
		return JSON.stringify(result);
	};
	// On the active cell (one per cell)
	engine["addComment"] = edit(function (text) {
		var ws = view();
		var data = newCommentData(Asc.asc_CCommentData, commentUser, text);
		// A cell's comment, not the workbook's (only those are placed and saved)
		data.asc_putDocumentFlag(false);
		var cell = ws.model.selectionRange.activeCell;
		data.asc_putCol(cell.col);
		data.asc_putRow(cell.row);
		ws.cellCommentator.addComment(data, noLock());
	});
	// The comment's sheet becomes the active one
	function changeComment(id, change) {
		var found = sheetComment(id);
		if (!found)
			return;
		if (found.sheet !== api.wb.model.getActive())
			api.asc_showWorksheet(found.sheet);
		var data = found.comment.clone();
		change(data);
		view().cellCommentator.changeComment(id, data, false, false, noLock());
	}
	engine["replyComment"] = edit(function (id, text) {
		changeComment(id, function (data) { data.asc_addReply(newCommentData(Asc.asc_CCommentData, commentUser, text)); });
	});
	engine["resolveComment"] = edit(function (id, solved) {
		changeComment(id, function (data) { data.asc_putSolved(solved); });
	});
	engine["deleteComment"] = edit(function (id) {
		var found = sheetComment(id);
		if (!found)
			return;
		if (found.sheet !== api.wb.model.getActive())
			api.asc_showWorksheet(found.sheet);
		view().cellCommentator.removeComment(id, false, noLock());
	});
	engine["gotoComment"] = function (id) {
		var found = sheetComment(id);
		if (!found)
			return;
		if (found.sheet !== api.wb.model.getActive())
			engine["setActiveSheet"](found.sheet);
		engine["selectCells"](found.comment.asc_getCol(), found.comment.asc_getRow(), found.comment.asc_getCol(), found.comment.asc_getRow());
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

	// "" for none or automatic
	function colorHex(color) {
		if (!color || !color.asc_getR || color.asc_getAuto())
			return "";
		return [color.asc_getR(), color.asc_getG(), color.asc_getB()].map(function (v) { return ("0" + v.toString(16)).slice(-2); }).join("").toUpperCase();
	}

	// Format of the active cell, for the cell format panel; the font of a selected drawing's text (textPr)
	function cellFormat(textPr) {
		var info = api.asc_getCellInfo();
		var xfs = info.asc_getXfs();
		var border = xfs.getBorder ? xfs.getBorder() : null;
		var hasBorder = !!(border && ((border.b && border.b.s) || (border.t && border.t.s) || (border.l && border.l.s) || (border.r && border.r.s)));
		return {
			"numFormat": xfs.asc_getNumFormat() || "General",
			"numFormatType": xfs.asc_getNumFormatInfo() ? xfs.asc_getNumFormatInfo().asc_getType() : 0,
			"fill": colorHex(xfs.asc_getFillColor()),
			"wrap": !!xfs.asc_getWrapText(),
			"merged": info.asc_getMerge() === Asc.c_oAscMergeOptions.Merge || info.asc_getMerge() === Asc.c_oAscMergeOptions.MergeCenter,
			"verticalAlign": xfs.asc_getVertAlign(),
			"border": hasBorder,
			"fontName": textPr ? themeFontName(api.wbModel.theme, textPr.FontFamily ? textPr.FontFamily.Name : "") : xfs.asc_getFontName() || "",
			"fontSize": textPr ? textPr.FontSize || 0 : xfs.asc_getFontSize() || 0,
			"strikeout": textPr ? !!textPr.Strikeout : !!xfs.asc_getFontStrikeout(),
			"color": textPr ? textPrColor(textPr) : colorHex(xfs.asc_getFontColor())
		};
	}

	function textPrColor(textPr) {
		var fill = textPr.Unifill && textPr.Unifill.fill;
		var rgba = fill && fill.color && fill.color.RGBA;
		if (!rgba)
			return "";
		return [rgba.R, rgba.G, rgba.B].map(function (v) { return ("0" + v.toString(16)).slice(-2); }).join("").toUpperCase();
	}

	// Commands that change cells redraw the sheet
	function edit(action) {
		return function () {
			var result = action.apply(null, arguments);
			changed = true;
			return result;
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

	// At the active cell, at most 12 cm wide or high. Its size is given: sdkjs would read it from
	// the picture loaded in a browser, and fits it into the cells shown, which here are none
	engine["insertImage"] = edit(function (name, width, height) {
		preloadImage(api, name, width, height);
		var scale = Math.min(1, 120 / AscCommon.g_dKoef_pix_to_mm / Math.max(width, height));
		var sheet = view(), lastCol = sheet.getLastVisibleCol, lastRow = sheet.getLastVisibleRow;
		sheet.getLastVisibleCol = function () { return sheet.getFirstVisibleCol(true) + 100; };
		sheet.getLastVisibleRow = function () { return sheet.getFirstVisibleRow(true) + 300; };
		try {
			sheet.objectRender.addImageDrawingObject([name], {
				cell: sheet.model.selectionRange.activeCell, width: width * scale, height: height * scale
			});
		} finally {
			sheet.getLastVisibleCol = lastCol;
			sheet.getLastVisibleRow = lastRow;
		}
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
	engine["pdfCommands"] = function () { return pdfCommands(api); };

	// ---------------------------------------------------------------------------------
	// Cell formatting (the selection)

	// sdkjs refuses some changes with an error event (shifting cells of a table, ...): reported once with the state
	var lastWarning = null;
	api.asc_registerCallback("asc_onError", function (id, level) {
		lastWarning = id;
	});

	function cellColor(hex) {
		return hex ? ascColor(hex) : null;
	}

	engine["setFontName"] = edit(function (name) { api.asc_setCellFontName(name); runTimers(200); });
	engine["setFontSize"] = edit(function (size) { api.asc_setCellFontSize(size); });
	engine["setStrikeout"] = edit(function (value) { api.asc_setCellStrikeout(value); });
	engine["setTextColor"] = edit(function (hex) { api.asc_setCellTextColor(ascColor(hex || "000000")); });
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
	// Borders of the selected cells: all, outer, inner, left, top, right, bottom or none
	engine["setBorders"] = edit(function (kind) {
		var o = Asc.c_oAscBorderOptions;
		var line = new Asc.asc_CBorder(Asc.c_oAscBorderStyles.Thin, rgbColor("000000"));
		var borders = [];
		if (kind === "all" || kind === "outer") {
			borders[o.Top] = borders[o.Right] = borders[o.Bottom] = borders[o.Left] = line;
		}
		if (kind === "all" || kind === "inner") {
			borders[o.InnerV] = borders[o.InnerH] = line;
		}
		// One side
		var sides = { "left": o.Left, "top": o.Top, "right": o.Right, "bottom": o.Bottom };
		if (sides[kind] !== undefined) {
			borders[sides[kind]] = line;
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
	// Fonts the cells use
	engine["getDocumentFonts"] = function () {
		return JSON.stringify(documentFonts(api.wbModel.generateFontMap()));
	};
	engine["getStyles"] = function () { return "[]"; };

	// Saving (Document::Save)
	engine["beforeSave"] = function () {};
	engine["afterSave"] = function (success) {
		if (success)
			AscCommon.History.Reset_SavedIndex();
	};
}
