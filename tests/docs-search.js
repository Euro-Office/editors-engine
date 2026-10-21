// document: document-templates/sample/sample.docx
// Find and replace
t.run("find", function () {
	eoEngine.keyDown(36, false, true);
	eoEngine.commitText("needle needle needle ");
	eoEngine.find("needle", false, false, true);
	var search = t.state()["search"];
	t.eq("matches", search["count"], 3);
	t.ok("a match is selected", t.state()["selection"].length > 0);
	eoEngine.replace("needle", "pin", false, false, true);
	t.ok("all replaced", documentText().indexOf("pin pin pin ") === 0);
	eoEngine.find("needle", false, false, true);
	t.eq("no match left", t.state()["search"]["count"], 0);
	eoEngine.endFind();
	t.eq("search closed", t.state()["search"], null);
});
t.noError("search");
t.done();
