// document: document-templates/sample/sample.xlsx
// save: cells-duplicate.xlsx
// Duplicating a sheet: a copy before it, named as web-apps names it, with its cells
// (cells-duplicate.reopen.js checks the saved file)
function sheet() { return t.state()["sheet"]; }
function cellText(col, row) {
	eoEngine.selectCells(col, row, col, row);
	return sheet()["text"];
}
t.run("duplicating", function () {
	var before = sheet();
	var name = before["sheets"][before["active"]]["name"];
	eoEngine.selectCells(0, 0, 0, 0);
	eoEngine.setCellText("Duplicated");
	eoEngine.duplicateSheet();
	var after = sheet();
	t.eq("one more sheet", after["sheets"].length, before["sheets"].length + 1);
	t.eq("the copy's name", after["sheets"][after["active"]]["name"], name + " (2)");
	t.eq("before the original", after["sheets"][after["active"] + 1]["name"], name);
	t.eq("its cells", cellText(0, 0), "Duplicated");
	eoEngine.duplicateSheet();
	t.eq("the next copy's name", sheet()["sheets"][sheet()["active"]]["name"], name + " (3)");
	t.noError("duplicating");
});
t.done();
