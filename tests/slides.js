// document: document-templates/sample/sample.pptx
// Slides: list, add, duplicate, delete, text for screen readers
t.run("slides", function () {
	var count = JSON.parse(eoEngine.getSlides()).length;
	t.ok("slides", count > 0);
	eoEngine.addSlide();
	t.eq("added", JSON.parse(eoEngine.getSlides()).length, count + 1);
	eoEngine.duplicateSlide();
	t.eq("duplicated", JSON.parse(eoEngine.getSlides()).length, count + 2);
	eoEngine.deleteSlide();
	eoEngine.deleteSlide();
	t.eq("deleted", JSON.parse(eoEngine.getSlides()).length, count);
	t.ok("text on slide 1", JSON.parse(eoEngine.textBlocks(0)).length > 0);
});
t.run("adds a text box", function () {
	eoEngine.gotoSlide(0);
	var presentation = Asc.editor.WordControl.m_oLogicDocument;
	eoEngine.insertTextBox(presentation.CurPage, 100, 60);
	var box = presentation.GetCurrentController().getSelectedArray()[0];
	t.ok("centered on the point", box && Math.abs(box.x + box.extX / 2 - 100) < 1 && Math.abs(box.y + box.extY / 2 - 60) < 10);
	eoEngine.enterText("A text box");
	t.ok("the text in it", Asc.editor.WordControl.m_oLogicDocument.Slides.some(function (slide) {
		return slide.cSld.spTree.some(function (shape) {
			var content = shape.getDocContent && shape.getDocContent();
			return content && content.GetText().indexOf("A text box") >= 0;
		});
	}));
});
t.run("formats a selected chart's text", function () {
	eoEngine.insertChart(0);
	t.ok("the chart is selected", t.state().drawings.length > 0);
	var bold = !!t.state().interface.Bold;
	eoEngine.setBold(!bold);
	t.eq("its bold is reported", !!t.state().interface.Bold, !bold);
	eoEngine.setBold(bold);
	t.eq("and back", !!t.state().interface.Bold, bold);
});
t.run("fills the whole chart", function () {
	var presentation = Asc.editor.WordControl.m_oLogicDocument;
	var shapes = presentation.Slides[presentation.CurPage].cSld.spTree;
	var chart = shapes[shapes.length - 1];
	// Its plot area selected inside it (a second tap)
	chart.selection.plotArea = chart.chart.plotArea;
	var plotFill = chart.chart.plotArea.spPr && chart.chart.plotArea.spPr.Fill;
	eoEngine.setShapeFill("FF0000");
	t.eq("the chart's fill", JSON.parse(eoEngine.drawingColors()).fill, "FF0000");
	t.ok("not the plot area's", (chart.chart.plotArea.spPr && chart.chart.plotArea.spPr.Fill) === plotFill);
	chart.selection.plotArea = chart.chart.plotArea;
	eoEngine.setShapeOutline("0000FF", 1, Asc.c_oDashType.dash);
	t.eq("the chart's outline", JSON.parse(eoEngine.drawingColors()).outline, "0000FF");
	t.eq("no shadows for charts", JSON.parse(eoEngine.drawingColors()).shadow, null);
});
t.run("titles a chart, reads its colors", function () {
	eoEngine.setChartTitles("Sales", "Quarter", "Euro");
	var chart = eoEngine.chartState();
	t.eq("title", chart.titleText, "Sales");
	t.eq("horizontal axis", chart.horizontalTitle, "Quarter");
	t.eq("vertical axis", chart.verticalTitle, "Euro");
	eoEngine.setChartElements(true, 4, false, true);
	t.eq("kept by the elements", eoEngine.chartState().titleText, "Sales");
	eoEngine.setShapeFill("FFEECC");
	t.eq("its fill", JSON.parse(eoEngine.drawingColors()).fill, "FFEECC");
});
t.run("styles and lays out a chart, sets its axes", function () {
	var chart = eoEngine.chartState();
	t.ok("styles of its type", chart.styles > 1);
	t.eq("previews of them", JSON.parse(eoEngine.previews("chartStyles")).length, chart.styles);
	eoEngine.setChartStyle(3);
	t.eq("style", eoEngine.chartState().style, 3);
	eoEngine.setChartLayout({ "legend": Asc.c_oAscChartLegendShowSettings.top, "verticalTitle": Asc.c_oAscChartVertAxisLabelShowSettings.horizontal,
		"horizontalGridlines": Asc.c_oAscGridLinesSettings.majorMinor });
	var layout = eoEngine.chartState().layout;
	t.eq("legend", layout.legend, Asc.c_oAscChartLegendShowSettings.top);
	t.eq("vertical axis' title", layout.verticalTitle, Asc.c_oAscChartVertAxisLabelShowSettings.horizontal);
	t.eq("gridlines", layout.horizontalGridlines, Asc.c_oAscGridLinesSettings.majorMinor);
	eoEngine.setChartAxis("value", { "min": 0, "max": 500, "units": Asc.c_oAscValAxUnits.HUNDREDS });
	var axis = eoEngine.chartState().valueAxis;
	t.eq("minimum", axis.min, 0);
	t.eq("maximum", axis.max, 500);
	t.eq("units", axis.units, Asc.c_oAscValAxUnits.HUNDREDS);
	eoEngine.setChartAxis("value", { "max": null });
	t.eq("automatic maximum", eoEngine.chartState().valueAxis.max, null);
	eoEngine.setChartAxis("category", { "reverse": true });
	t.ok("reversed categories", eoEngine.chartState().categoryAxis.reverse);
});
t.run("slide layouts, table styles and the background", function () {
	var layouts = JSON.parse(eoEngine.previews("layouts"));
	t.eq("a picture per layout", layouts.length, JSON.parse(eoEngine.getLayouts()).length);
	var styles = JSON.parse(eoEngine.previews("tableStyles"));
	t.ok("table styles", styles.length > 10);
	click(0, 5, 5);
	eoEngine.insertTable(3, 2, styles[5].id);
	var table = Asc.editor.WordControl.m_oLogicDocument.GetCurrentController().getSelectedArray()[0];
	t.eq("a table of the style", table && table.graphicObject.TableStyle, styles[5].id);
	t.ok("in the table", t.state()["structure"]["inTable"]);
	eoEngine.tableAction("rowBelow");
	t.eq("a row added", table.graphicObject.Content.length, 3);
	eoEngine.undo();
	eoEngine.undo();
	eoEngine.setSlideBackground("FF0000");
	t.eq("background", JSON.parse(eoEngine.getSlideBackground()), "FF0000");
	eoEngine.undo();
});
t.run("designs", function () {
	var designs = JSON.parse(eoEngine.previews("themes"));
	t.ok("designs prepared", designs.length > 5);
	t.eq("by their names", designs[4].name, "Green leaf");
	var masters = Asc.editor.WordControl.m_oLogicDocument.slideMasters.length;
	eoEngine.setTheme(4);
	var presentation = Asc.editor.WordControl.m_oLogicDocument;
	t.eq("the slides' design", presentation.Slides[0].Layout.Master.Theme.name, presentation.slideMasters[presentation.slideMasters.length - 1].Theme.name);
	t.ok("a new master", presentation.slideMasters.length >= masters);
	eoEngine.undo();
});
t.run("copies and pastes a text box", function () {
	var presentation = Asc.editor.WordControl.m_oLogicDocument;
	eoEngine.gotoSlide(0);
	eoEngine.insertTextBox(0, 100, 60);
	eoEngine.enterText("Copied");
	eoEngine.keyDown(27, false, false);
	var copied = JSON.parse(eoEngine.copy());
	t.ok("copied in sdkjs' format", copied.internal.length > 0);
	var count = presentation.Slides[0].cSld.spTree.length;
	eoEngine.paste(copied.text, copied.internal);
	t.eq("pasted", presentation.Slides[0].cSld.spTree.length, count + 1);
});
t.run("moves a text box dropped on the next slide there", function () {
	var presentation = Asc.editor.WordControl.m_oLogicDocument;
	eoEngine.addSlide();
	eoEngine.gotoSlide(0);
	var tree = presentation.Slides[0].cSld.spTree;
	var box = tree[tree.length - 1];
	var controller = presentation.GetCurrentController();
	controller.resetSelection();
	controller.selectObject(box, 0);
	var counts = [presentation.Slides[0].cSld.spTree.length, presentation.Slides[1].cSld.spTree.length];
	// Dragged by its top edge 30 mm below the slide's bottom, which the app shows 200 mm below its top
	var dy = presentation.GetHeightMM() + 30 - box.y;
	eoEngine.mouse(0, 0, box.x + box.extX / 4, box.y, 1, false, false);
	eoEngine.mouse(1, 0, box.x + box.extX / 4, box.y + dy, 1, false, false);
	t.eq("its frame on its slide while it moves", t.state().drawings[0].page, 0);
	eoEngine.mouse(2, 0, box.x + box.extX / 4, box.y + dy, 1, false, false);
	eoEngine.moveToSlide(1, 200);
	t.eq("gone from its slide", presentation.Slides[0].cSld.spTree.length, counts[0] - 1);
	t.eq("on the next one", presentation.Slides[1].cSld.spTree.length, counts[1] + 1);
	var moved = presentation.GetCurrentController().getSelectedArray()[0];
	t.ok("where it was dropped", moved && Math.abs(moved.y - (presentation.GetHeightMM() + 30 - 200)) < 1);
	t.eq("the next slide is current", t.state().currentPage, 1);
});
t.run("presentation settings", function () {
	var schemes = JSON.parse(eoEngine.getColorSchemes());
	t.ok("color schemes listed", schemes["schemes"].length > 5 && schemes["schemes"][0]["colors"].length >= 6);
	t.ok("one is current", schemes["current"] >= 0);
	var other = schemes["current"] === 1 ? 2 : 1;
	eoEngine.setColorScheme(other);
	t.eq("color scheme changed", JSON.parse(eoEngine.getColorSchemes())["current"], other);
	eoEngine.setSlideSize(false);
	var size = JSON.parse(eoEngine.getSlideSize());
	t.ok("4:3", Math.abs(size["width"] / size["height"] - 4 / 3) < 0.01);
	eoEngine.setSlideSize(true);
	size = JSON.parse(eoEngine.getSlideSize());
	t.ok("16:9", Math.abs(size["width"] / size["height"] - 16 / 9) < 0.01);
});
t.run("document fonts", function () {
	var used = JSON.parse(eoEngine.getDocumentFonts());
	t.ok("listed: " + used.join(), used.length > 0 && used.indexOf("Arial") >= 0);
	t.ok("without the theme's placeholders", used.every(function (name) { return name.charAt(0) !== "+"; }));
});
t.run("theme colors", function () {
	var colors = JSON.parse(eoEngine.getThemeColors());
	t.eq("6 of each of the theme's 10 colors", colors.theme.length, 60);
	eoEngine.insertShape("rect");
	eoEngine.setShapeFill("theme:30"); // accent 2
	eoEngine.setShapeOutline("theme:9", 1); // text 1, lighter
	var drawing = JSON.parse(eoEngine.drawingColors());
	t.eq("the shape's fill", drawing.fill, colors.theme[30]);
	t.eq("its outline", drawing.outline, colors.theme[9]);
	var schemes = JSON.parse(eoEngine.getColorSchemes());
	eoEngine.setColorScheme(schemes.current === 1 ? 2 : 1);
	var changed = JSON.parse(eoEngine.getThemeColors());
	t.ok("other theme colors", changed.theme[30] !== colors.theme[30]);
	t.eq("the fill changed with them", JSON.parse(eoEngine.drawingColors()).fill, changed.theme[30]);
	eoEngine.undo();
});
t.run("text direction", function () {
	eoEngine.insertShape("rect");
	t.eq("horizontal", JSON.parse(eoEngine.drawingColors()).vert, 1);
	eoEngine.setTextVert(4);
	t.eq("rotated up", JSON.parse(eoEngine.drawingColors()).vert, 4);
	eoEngine.insertTextBox(0, 100, 100);
	eoEngine.enterText("RTL");
	eoEngine.setRtl(true);
	t.eq("right to left", t.state().format.Rtl, true);
});
t.run("all caps and small caps", function () {
	eoEngine.insertTextBox(0, 100, 140);
	eoEngine.enterText("Caps");
	eoEngine.selectAll();
	eoEngine.setCaps(true);
	t.eq("all caps", [t.state().format.Caps, t.state().format.SmallCaps].join(), "true,false");
	eoEngine.setSmallCaps(true);
	t.eq("small caps instead", [t.state().format.Caps, t.state().format.SmallCaps].join(), "false,true");
	eoEngine.setSmallCaps(false);
	t.eq("neither", [t.state().format.Caps, t.state().format.SmallCaps].join(), "false,false");
});
t.run("text language", function () {
	eoEngine.insertTextBox(0, 100, 220);
	eoEngine.enterText("Bonjour");
	eoEngine.selectAll();
	eoEngine.setTextLanguage(1036);
	t.eq("French", [t.state().format.Lang, t.state().format.LangTag].join(), "1036,fr-FR");
});
// Draws each preview of a kind into a tile: no exceptions, something drawn
function drawPreviews(kind) {
	var items = JSON.parse(eoEngine.previews(kind));
	items.forEach(function (item, i) {
		eoEngine.beginTile();
		eoEngine.drawTile(-1 - i, 64, 64, 0, 0, 64, 64);
	});
	return items.length;
}
t.run("list presets", function () {
	eoEngine.insertTextBox(0, 100, 100);
	eoEngine.enterText("Item");
	t.eq("bullet pictures", drawPreviews("list-bullets"), 7);
	t.eq("number pictures", drawPreviews("list-numbers"), 7);
	eoEngine.setListPreset("numbers", 5);
	t.eq("the preset is current", JSON.parse(eoEngine.getListPresets()).numbers, 5);
	t.eq("numbers in the state", t.state().format.List, 1);
	t.eq("no bullets", JSON.parse(eoEngine.getListPresets()).bullets, -1);
	eoEngine.setListPreset("bullets", 2);
	t.eq("bullets now", JSON.parse(eoEngine.getListPresets()).bullets, 2);
	t.eq("bullets in the state", t.state().format.List, 0);
});
t.run("outlines: width and dash", function () {
	eoEngine.insertShape("rect");
	eoEngine.setShapeOutline("FF0000", 2.12, Asc.c_oDashType.sysDot);
	var colors = JSON.parse(eoEngine.drawingColors());
	t.eq("color", colors.outline, "FF0000");
	t.ok("width", Math.abs(colors.outlineWidth - 2.12) < 0.01);
	t.eq("dash", colors.outlineDash, Asc.c_oDashType.sysDot);
	eoEngine.setShapeOutline("FF0000", 2.12, Asc.c_oDashType.solid);
	t.eq("solid again", JSON.parse(eoEngine.drawingColors()).outlineDash, Asc.c_oDashType.solid);
});
t.run("opacity and shadow", function () {
	eoEngine.insertShape("rect");
	eoEngine.setShapeFill("00FF00");
	eoEngine.setShapeOpacity(40);
	var colors = JSON.parse(eoEngine.drawingColors());
	t.eq("opacity", colors.opacity, 40);
	t.eq("the color stays", colors.fill, "00FF00");
	eoEngine.setShapeShadow("br");
	t.eq("shadow", JSON.parse(eoEngine.drawingColors()).shadow, "br");
	eoEngine.setShapeShadow("");
	t.eq("no shadow", JSON.parse(eoEngine.drawingColors()).shadow, "");
});
t.run("fills", function () {
	var resources = JSON.parse(eoEngine.getFillResources());
	t.eq("patterns", resources.patterns.length, 54);
	t.ok("8 x 8 each", resources.patterns.every(function (p) { return /^[01]{64}$/.test(p); }));
	t.ok("textures", resources.textures.length > 5 && resources.textures[0].indexOf("data:image/png") === 0);
	eoEngine.insertShape("rect");
	eoEngine.setFill("shape", { "type": "gradient", "angle": 90, "stops": [{ "color": "FF0000", "position": 0 }, { "color": "theme:24", "position": 100 }] });
	var fill = JSON.parse(eoEngine.getFill("shape"));
	t.eq("gradient", fill.type, "gradient");
	t.ok("its stops", fill.stops.length === 2 && fill.stops[0].color === "FF0000" && fill.stops[1].position === 100);
	t.eq("its angle", fill.angle, 90);
	eoEngine.setFill("shape", { "type": "gradient", "radial": true, "stops": [{ "color": "FFFFFF", "position": 0 }, { "color": "000000", "position": 100 }] });
	t.eq("radial", JSON.parse(eoEngine.getFill("shape")).radial, true);
	eoEngine.setFill("shape", { "type": "pattern", "pattern": 6, "foreground": "0000FF", "background": "FFFF00" });
	fill = JSON.parse(eoEngine.getFill("shape"));
	t.ok("pattern", fill.type === "pattern" && fill.pattern === 6 && fill.foreground === "0000FF" && fill.background === "FFFF00");
	eoEngine.setFill("shape", { "type": "texture", "texture": 3 });
	fill = JSON.parse(eoEngine.getFill("shape"));
	t.ok("texture", fill.type === "texture" && fill.texture === 3);
	// A picture's tiling without a new picture keeps the shape's
	eoEngine.setFill("shape", { "type": "picture", "tile": false });
	fill = JSON.parse(eoEngine.getFill("shape"));
	t.ok("stretched, the same picture", fill.type === "texture" && fill.texture === 3);
	eoEngine.setFill("slide", { "type": "gradient", "angle": 0, "stops": [{ "color": "00FF00", "position": 0 }, { "color": "0000FF", "position": 100 }] });
	t.eq("slide background", JSON.parse(eoEngine.getFill("slide")).type, "gradient");
	eoEngine.setFill("slide", { "type": "solid", "color": "FFFFFF" });
	t.eq("solid", JSON.parse(eoEngine.getFill("slide")).color, "FFFFFF");
});
t.run("transition timing", function () {
	var current = JSON.parse(eoEngine.getCurrentSlide());
	eoEngine.setTransition(7, 15, 1500, false); // clock, counterclockwise
	eoEngine.setSlideAdvance(false, true, 3000, false);
	var transition = JSON.parse(eoEngine.getSlides())[current].transition;
	t.ok("clock", transition.type === 7 && transition.option === 15 && transition.duration === 1500);
	t.ok("after 3 s, not on a tap", !transition.onClick && transition.after && transition.afterDuration === 3000);
});
t.noError("slides");
t.done();
