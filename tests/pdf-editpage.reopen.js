// The PDF pdf-editpage.js saved with its edited page: the text typed is the file's text
t.eq("the PDF editor", eoEngine.kind, "pdf");
t.eq("drawn from the file", eoEngine.pageOrigin(0), 0);
t.run("finds the text typed", function () {
	eoEngine.find("Edited", true, true, true);
	t.ok("in the file", t.state().search.count > 0);
	eoEngine.endFind();
});
t.run("keeps the rest of the text", function () {
	eoEngine.find("key tools", true, false, true);
	t.ok("in the file", t.state().search.count > 0);
	eoEngine.endFind();
});
t.done();
