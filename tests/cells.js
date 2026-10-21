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
t.noError("cells");
t.done();
