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
	eoEngine.undo();
	eoEngine.setSlideBackground("FF0000");
	t.eq("background", JSON.parse(eoEngine.getSlideBackground()), "FF0000");
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
t.noError("slides");
t.done();
