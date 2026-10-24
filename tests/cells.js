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
t.run("a shape filled with a picture", function () {
	eoEngine.selectCells(5, 3, 5, 3);
	eoEngine.insertShape("rect");
	eoEngine.setFill("shape", { "type": "picture", "picture": "picture.png", "width": 400, "height": 200, "tile": false });
	var drawings = Asc.editor.wb.getWorksheet().model.Drawings;
	var fill = drawings[drawings.length - 1].graphicObject.spPr.Fill.fill;
	t.ok("its picture", fill.type === Asc.c_oAscFill.FILL_TYPE_BLIP && fill.RasterImageId.indexOf("picture.png") >= 0);
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
t.run("draws sheets with a header and footer", function () {
	// As "Stand der Dinge_2025.xlsx": the sheet's name above, the page number below
	var headerFooter = Asc.editor.wb.getWorksheet().model.headerFooter;
	headerFooter.setOddHeader("&C&A");
	headerFooter.setOddFooter("&CSeite &P");
	eoEngine.beginTile();
	eoEngine.drawTile(0, 1024, Math.round(1024 * eoEngine.getPageHeight(0) / eoEngine.getPageWidth(0)), 0, 0, 256, 256);
	t.ok("print drawing's base transform", typeof AscCommon.CNativeGraphics.prototype.SetBaseTransform === "function");
});
t.run("theme colors", function () {
	var colors = JSON.parse(eoEngine.getThemeColors());
	t.eq("6 of each of the theme's 10 colors", colors.theme.length, 60);
	t.eq("standard colors", colors.standard.length, 10);
	eoEngine.selectCells(8, 8, 8, 8);
	eoEngine.setCellFill("theme:33"); // accent 2, darker
	eoEngine.setTextColor("theme:24"); // accent 1
	var format = t.state().sheet.cellFormat;
	t.eq("the cell's fill", format.fill, colors.theme[33]);
	t.eq("its text's color", format.color, colors.theme[24]);
	eoEngine.setCellFill("");
	t.eq("no fill", t.state().sheet.cellFormat.fill, "");
});
t.run("text angle and direction", function () {
	eoEngine.selectCells(9, 9, 9, 9);
	eoEngine.setCellText("Tilted");
	eoEngine.selectCells(9, 9, 9, 9);
	eoEngine.setTextAngle(45);
	t.eq("tilted up", t.state().sheet.cellFormat.angle, 45);
	eoEngine.setTextAngle(255);
	t.eq("vertical", t.state().sheet.cellFormat.angle, 255);
	eoEngine.setTextAngle(0);
	t.eq("horizontal", t.state().sheet.cellFormat.angle, 0);
	eoEngine.setRtl(true);
	t.eq("right to left", t.state().sheet.cellFormat.rtl, true);
	eoEngine.setRtl(false);
	t.eq("left to right", t.state().sheet.cellFormat.rtl, false);
});
t.run("cell styles", function () {
	var names = JSON.parse(eoEngine.getCellStyles());
	t.ok("built-in styles: " + names.length, names.indexOf("Good") >= 0 && names.indexOf("Heading 1") >= 0);
	var pictures = JSON.parse(eoEngine.previews("cellStyles"));
	t.eq("a picture each", pictures.length, names.length);
	eoEngine.setStyleLabels(JSON.stringify({ "Good": "Gut" }));
	var good = names.indexOf("Good");
	eoEngine.beginTile();
	t.ok("the picture of \"Good\" drawn", eoEngine.drawTile(-1 - good, 112, 36, 0, 0, 112, 36));
	eoEngine.selectCells(10, 10, 10, 10);
	eoEngine.setCellStyle("Good");
	var format = t.state().sheet.cellFormat;
	t.eq("the cell's style", format.style, "Good");
	t.eq("its fill", format.fill, "C6EFCE");
});

t.run("draws text at an angle in tiles", function () {
	// Down45 in a column of its own, in a tile that starts at that column: sdkjs sets the text's
	// transform (sheet coordinates) and resets it, the tile keeps its first cell's place
	eoEngine.selectCells(12, 3, 12, 3);
	eoEngine.setCellText("Down45");
	eoEngine.selectCells(12, 3, 12, 3);
	eoEngine.setTextAngle(-45);
	eoEngine.getState();
	var ws = Asc.editor.wb.getWorksheet();
	var mmPerPx = 25.4 / 96;
	var left = (ws._getColLeft(12) - ws._getColLeft(0)) * mmPerPx;
	var pageWidth = Math.round(eoEngine.getPageWidth(0) / mmPerPx), pageHeight = Math.round(eoEngine.getPageHeight(0) / mmPerPx);
	var transforms = [];
	var transform = AscCommon.CNativeGraphics.prototype.transform;
	AscCommon.CNativeGraphics.prototype.transform = function (sx, shy, shx, sy, tx, ty) {
		transforms.push([sx, shy, shx, sy, tx, ty]);
		return transform.apply(this, arguments);
	};
	try {
		eoEngine.beginTile();
		eoEngine.drawTile(0, pageWidth, pageHeight, Math.round(left / mmPerPx), 0, 256, 256);
	} finally {
		AscCommon.CNativeGraphics.prototype.transform = transform;
	}
	var rotated = transforms.filter(function (m) { return Math.abs(m[1]) > 0.5; });
	t.ok("the text is rotated", rotated.length > 0);
	t.ok("in its cell: " + rotated.map(function (m) { return m[4].toFixed(1); }).join() + " from " + left.toFixed(1),
		rotated.every(function (m) { return m[4] >= left && m[4] < left + 30; }));
	var last = transforms[transforms.length - 1];
	t.ok("then back at the tile's first cell: " + last.join(), last[0] === 1 && Math.abs(last[4] - left) < 0.01);
});
t.done();
