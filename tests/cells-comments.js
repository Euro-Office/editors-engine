// document: document-templates/sample/sample.xlsx
// save: cells-comments.xlsx
// Comments on cells are saved (cells-comments.reopen.js checks the saved file)
t.run("comments a cell", function () {
	eoEngine.setCommentUser("tester", "Tester");
	eoEngine.selectCells(1, 2, 1, 2);
	eoEngine.addComment("A cell comment");
	var comments = JSON.parse(eoEngine.getComments());
	var added = comments.filter(function (comment) { return comment.text === "A cell comment"; })[0];
	t.ok("the comment", !!added);
	t.eq("on the cell", added && [added.col, added.row].join(), "1,2");
});
t.done();
