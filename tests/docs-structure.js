// document: document-templates/sample/sample.docx
// Tables, outline, statistics, comments
t.run("table", function () {
	eoEngine.keyDown(35, false, true); // Ctrl+End
	eoEngine.insertTable(3, 2);
	t.ok("in the table", t.state()["structure"]["inTable"]);
});
t.run("statistics", function () {
	var statistics = JSON.parse(eoEngine.getStatistics());
	t.ok("words counted", statistics["words"] > 0);
});
t.run("comments", function () {
	eoEngine.keyDown(36, false, true);
	eoEngine.keyDown(39, true, true);
	eoEngine.setCommentUser("test", "Tester");
	var before = JSON.parse(eoEngine.getComments()).length;
	eoEngine.addComment("A comment");
	var comments = JSON.parse(eoEngine.getComments());
	t.eq("comment added", comments.length, before + 1);
	var added = comments.filter(function (comment) { return comment["text"] === "A comment"; })[0];
	t.ok("the new comment", !!added);
	eoEngine.replyComment(added["id"], "A reply");
	eoEngine.resolveComment(added["id"], true);
	added = JSON.parse(eoEngine.getComments()).filter(function (comment) { return comment["id"] === added["id"]; })[0];
	t.eq("reply", added["replies"].length, 1);
	t.eq("resolved", added["solved"], true);
});
t.noError("structure");
t.done();
