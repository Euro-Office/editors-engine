// The PDF docs-pdf.js saved, in sdkjs' PDF editor (pdf.js): text, markups, notes, search, saving
t.eq("the PDF editor", eoEngine.kind, "pdf");
var annotations = function () { return Asc.editor.getPDFDoc().annots.length; };
var before = annotations();
t.run("selects text", function () {
	eoEngine.select(0, 10, 10, 0, 200, 60);
	var state = t.state();
	t.ok("a selection", state.selection.length > 0);
	t.ok("text to copy", JSON.parse(eoEngine.copy()).text.length > 0);
});
t.run("marks the text up", function () {
	eoEngine.markup("highlight", "FFEB3B");
	t.eq("a highlight", annotations(), before + 1);
	t.ok("pages to draw again", Object.keys(t.state().dirtyPages).length > 0);
});
t.run("adds a note", function () {
	eoEngine.setCommentUser("tester", "Tester");
	eoEngine.mouse(0, 0, 100, 150, 1, false, false);
	eoEngine.mouse(2, 0, 100, 150, 1, false, false);
	eoEngine.addComment("A note");
	t.ok("the note", JSON.parse(eoEngine.getComments()).some(function (comment) { return comment.text === "A note"; }));
});
t.run("adds a text box", function () {
	var count = annotations();
	eoEngine.addFreeText(0, 60, 80);
	t.eq("a free text annotation", annotations(), count + 1);
	t.ok("the cursor in it", t.state().cursor !== null);
	eoEngine.enterText("A text box");
	var box = Asc.editor.getPDFDoc().annots[annotations() - 1];
	eoEngine.mouse(0, 0, 150, 250, 1, false, false);
	eoEngine.mouse(2, 0, 150, 250, 1, false, false);
	t.eq("its text", box.GetContents(), "A text box");
});
t.run("draws with the pen", function () {
	var count = annotations();
	eoEngine.startInk("E53935", 0.7);
	eoEngine.mouse(0, 0, 50, 200, 1, false, false);
	eoEngine.mouse(1, 0, 60, 210, 1, false, false);
	eoEngine.mouse(2, 0, 70, 200, 1, false, false);
	eoEngine.stopInk();
	t.eq("an ink annotation", annotations(), count + 1);
});
t.run("finds text", function () {
	eoEngine.find("Text", false, false, true);
	var state = t.state();
	t.ok("matches", state.search.count > 0);
	t.ok("the match is selected", state.selection.length > 0);
	eoEngine.endFind();
});
t.run("undoes", function () {
	var count = annotations();
	eoEngine.undo();
	t.eq("one annotation less", annotations(), count - 1);
});
t.run("saves the changes", function () {
	var commands = eoEngine.savePdf();
	t.ok("edit commands", commands && commands.length > 4);
});
t.noError("the PDF editor");
t.done();
