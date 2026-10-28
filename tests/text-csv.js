// document: editors-engine/tests/documents/semicolon.csv
// save: text-csv.csv
// A csv with semicolons (and decimal commas) in Windows-1252, saved with both again
function cell(row, column) {
	return Asc.editor.wb.getWorksheet().model.getCell3(row, column).getValue();
}
t.eq("encoding", eoEngine.textOptions.encoding, 44);
t.eq("delimiter", eoEngine.textOptions.delimiter, 2);
t.eq("first cell", cell(0, 0), "Name");
t.eq("an umlaut", cell(1, 0), "Müller");
t.eq("a quoted semicolon", cell(2, 2), "Bonn; Rhein");
t.eq("three columns", cell(0, 3), "");
t.done();
