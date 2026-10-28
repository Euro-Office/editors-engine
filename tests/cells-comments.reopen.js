// The workbook cells-comments.js saved: its comment is still there
t.run("the comment is saved", function () {
	var added = JSON.parse(eoEngine.getComments()).filter(function (comment) { return comment.text === "A cell comment"; })[0];
	t.ok("the comment", !!added);
	t.eq("on its cell", added && [added.col, added.row].join(), "1,2");
	t.eq("by its author", added && added.user, "Tester");
});
t.done();
