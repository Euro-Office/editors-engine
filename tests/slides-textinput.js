// document: document-templates/sample/sample.pptx
// The text around the cursor in a slide's text box (see docs-textinput.js)
function context() { return JSON.parse(eoEngine.getTextContext()); }
t.run("a text box's paragraph", function () {
	eoEngine.gotoSlide(1);
	t.eq("no text cursor", eoEngine.getTextContext(), "null");
	eoEngine.insertTextBox(1, 100, 60);
	eoEngine.enterText("One two");
	var text = context();
	t.eq("text", [text.text, text.start, text.end].join(), "One two,7,7");
	eoEngine.setTextSelection(4, 7);
	t.eq("selected", JSON.parse(eoEngine.copy()).text, "two");
	var rects = JSON.parse(eoEngine.getSelectionRects(4, 7));
	t.eq("on the slide", rects.length && rects[0].page, 1);
	eoEngine.setTextSelection(4, 4);
	var cursor = t.state().cursor;
	var caret = JSON.parse(eoEngine.getCaretRect(4));
	t.ok("the cursor's place", caret.page === 1 && Math.abs(caret.x1 - cursor.x1) < 0.01 && Math.abs(caret.y2 - cursor.y2) < 0.01);
	eoEngine.replaceText(0, 3, "Three");
	t.eq("replaced", context().text, "Three two");
});
t.done();
