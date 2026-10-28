// The file cells-duplicate.js saved
var sheets = t.state()["sheet"]["sheets"].map(function (sheet) { return sheet["name"]; });
var copy = sheets.filter(function (name) { return / \(2\)$/.test(name); })[0];
t.ok("the copies", copy && sheets.indexOf(copy.replace("(2)", "(3)")) >= 0);
eoEngine.setActiveSheet(sheets.indexOf(copy));
eoEngine.selectCells(0, 0, 0, 0);
t.eq("the copy's cells", t.state()["sheet"]["text"], "Duplicated");
t.done();
