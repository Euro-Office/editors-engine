// document: document-templates/sample/sample.xlsx
// Cells: entering values and formulas, formatting, undo, selecting everything
t.run("cells", function () {
	eoEngine.addSheet("Engine test");
	eoEngine.selectCells(0, 0, 0, 0);
	eoEngine.setCellText("20");
	eoEngine.selectCells(0, 1, 0, 1);
	eoEngine.setCellText("22");
	eoEngine.selectCells(0, 2, 0, 2);
	eoEngine.setCellText("=A1+A2");
	eoEngine.selectCells(0, 2, 0, 2);
	var sheet = t.state()["sheet"];
	t.eq("formula", sheet["text"], "=A1+A2");
	t.eq("value", Asc.editor.wb.getWorksheet().model.getCell3(2, 0).getValue(), "42");
	eoEngine.setBold(true);
	t.eq("bold", t.state()["interface"]["Bold"], true);
	eoEngine.undo();
	t.eq("undone", t.state()["interface"]["Bold"], false);
	eoEngine.selectCells(0, 0, 16383, 1048575);
	sheet = t.state()["sheet"];
	t.eq("everything selected", [sheet["c2"], sheet["r2"]].join(), "16383,1048575");
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
t.run("titles a chart and gives it cells", function () {
	eoEngine.setChartTitles("Answers", "", "");
	t.eq("title", eoEngine.chartState().titleText, "Answers");
	t.ok("style pictures", JSON.parse(eoEngine.previews("chartStyles")).length > 1);
	eoEngine.setChartStyle(2);
	t.eq("a style", eoEngine.chartState().style, 2);
	eoEngine.setChartLayout({ "legend": Asc.c_oAscChartLegendShowSettings.left });
	t.eq("its legend", eoEngine.chartState().layout.legend, Asc.c_oAscChartLegendShowSettings.left);
	eoEngine.startChartRange();
	t.eq("cells are selected meanwhile", t.state().drawings.length, 0);
	eoEngine.selectCells(0, 0, 0, 2);
	t.eq("the selected cells", eoEngine.endChartRange(true), 0);
	var chart = eoEngine.chartState();
	t.ok("selected again", chart !== null);
	t.eq("its range", chart && chart.range.replace(/^=/, ""), "'Engine test'!$A$1:$A$3");
	t.ok("an invalid range refused", eoEngine.setChartRange("nothing!!") !== 0);
	t.eq("the chart deleted", (eoEngine.clearCells(), t.state().drawings.length), 0);
});
t.run("inserts a picture at its size", function () {
	eoEngine.selectCells(3, 3, 3, 3);
	eoEngine.insertImage("picture.png", 400, 200);
	var drawings = Asc.editor.wb.getWorksheet().model.Drawings;
	var picture = drawings[drawings.length - 1].graphicObject;
	t.ok("its size", Math.abs(picture.extX - 400 * 25.4 / 96) < 1 && Math.abs(picture.extY - 200 * 25.4 / 96) < 1);
});
t.run("borders of one side", function () {
	eoEngine.selectCells(4, 6, 4, 6);
	eoEngine.setBorders("left");
	var ws = Asc.editor.wb.getWorksheet().model;
	var border = ws.getCell3(6, 4).getBorderFull();
	t.ok("left", border.l.s !== Asc.c_oAscBorderStyles.None);
	t.ok("not right", border.r.s === Asc.c_oAscBorderStyles.None);
	eoEngine.setBorders("none");
	t.ok("none", ws.getCell3(6, 4).getBorderFull().l.s === Asc.c_oAscBorderStyles.None);
});
t.run("spreadsheet settings", function () {
	var schemes = JSON.parse(eoEngine.getColorSchemes());
	t.ok("color schemes listed", schemes["schemes"].length > 5 && schemes["schemes"][0]["colors"].length >= 6);
	t.ok("one is current", schemes["current"] >= 0);
	var other = schemes["current"] === 1 ? 2 : 1;
	eoEngine.setColorScheme(other);
	t.eq("color scheme changed", JSON.parse(eoEngine.getColorSchemes())["current"], other);
	t.ok("gridlines shown", JSON.parse(eoEngine.getSheetSetup())["gridlines"]);
	eoEngine.setGridlines(false);
	t.ok("gridlines hidden", !JSON.parse(eoEngine.getSheetSetup())["gridlines"]);
	eoEngine.setSheetPage({ "landscape": true });
	t.ok("landscape", JSON.parse(eoEngine.getSheetSetup())["landscape"]);
	eoEngine.setSheetPage({ "width": 148, "height": 210 });
	var setup = JSON.parse(eoEngine.getSheetSetup());
	t.ok("A5", Math.round(Math.min(setup["width"], setup["height"])) === 148);
});
t.run("document fonts", function () {
	var used = JSON.parse(eoEngine.getDocumentFonts());
	t.ok("listed: " + used.join(), used.length > 0 && used.indexOf("Arial") >= 0);
	t.ok("without the theme's placeholders", used.every(function (name) { return name.charAt(0) !== "+"; }));
});
t.noError("cells");
t.done();
