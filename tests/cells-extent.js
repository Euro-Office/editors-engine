// document: document-templates/sample/sample.xlsx
// The sheet reaches as far as its content and the active cell (plus a margin), not as far as
// formatted columns and rows
t.run("extent", function () {
	eoEngine.addSheet("Extent");
	var empty = JSON.parse(eoEngine.getState())["sheet"]["geometry"];
	t.eq("an empty sheet's columns", empty && empty["cols"].length, 27);
	// A formatted but empty column, as LibreOffice writes them
	eoEngine.selectCells(100, 0, 100, 1048575);
	eoEngine.setBold(true);
	eoEngine.selectCells(0, 0, 0, 0);
	var formatted = JSON.parse(eoEngine.getState())["sheet"]["geometry"];
	t.eq("not up to formatted columns", formatted ? formatted["cols"].length : 27, 27);
	eoEngine.selectCells(60, 3, 60, 3);
	eoEngine.setCellText("far");
	eoEngine.selectCells(0, 0, 0, 0);
	var filled = JSON.parse(eoEngine.getState())["sheet"]["geometry"];
	t.eq("up to the content and 10 more", filled && filled["cols"].length, 60 + 1 + 10 + 1);
	eoEngine.undo();
	// Undo selects the cell again
	eoEngine.selectCells(0, 0, 0, 0);
	var undone = JSON.parse(eoEngine.getState())["sheet"]["geometry"];
	t.eq("back after undo", undone && undone["cols"].length, 27);
});
t.done();
