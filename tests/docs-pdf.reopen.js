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
t.run("places the pages for taps into text boxes", function () {
	// Taps on text boxes laid out by drawing convert their points with the pages' places
	var drawingDocument = Asc.editor.getPDFDoc().GetDrawingDocument();
	t.eq("a place per page", drawingDocument.m_arrPages.length, eoEngine.getPageCount());
	t.ok("points convert", !drawingDocument.ConvertCoordsToCursorWR(10, 10, 0).Error);
});
t.run("adds a text box while a word is composed", function () {
	// Out of the way of the other tests' boxes
	eoEngine.addFreeText(0, 170, 30);
	eoEngine.setComposingText("one");
	eoEngine.addFreeText(0, 170, 270);
	eoEngine.setComposingText("two");
	eoEngine.finishComposingText();
	var doc = Asc.editor.getPDFDoc();
	var text = function (annot) { return annot.GetDocContent().GetText({ ParaSeparator: "" }); };
	t.eq("the first keeps its word", text(doc.annots[doc.annots.length - 2]), "one");
	t.eq("the second has its own", text(doc.annots[doc.annots.length - 1]), "two");
	click(0, 150, 250);
});
t.run("copies, pastes and deletes a text box", function () {
	var count = annotations();
	click(0, 60, 80);
	var copied = JSON.parse(eoEngine.copy());
	t.ok("copied in sdkjs' format", copied.internal.length > 0);
	// Pasted where the page was last touched
	click(0, 120, 150);
	eoEngine.paste(copied.text, copied.internal);
	t.eq("pasted", annotations(), count + 1);
	var pasted = Asc.editor.getPDFDoc().annots[annotations() - 1];
	var rect = pasted.GetRect();
	t.ok("where the page was touched", Math.abs((rect[1] + rect[3]) / 2 * 25.4 / 72 - 150) < 5);
	t.ok("selected", t.state().drawings.length > 0);
	eoEngine.keyDown(46, false, false);
	t.eq("deleted with the Delete key", annotations(), count);
});
t.run("places a signature in one undo step", function () {
	var drawings = Asc.editor.getPDFDoc().drawings.length;
	eoEngine.placeImage("signature.png", 200, 100, 0, 30, 30, 40, 20);
	t.eq("a picture", Asc.editor.getPDFDoc().drawings.length, drawings + 1);
	eoEngine.undo();
	t.eq("undone", Asc.editor.getPDFDoc().drawings.length, drawings);
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
