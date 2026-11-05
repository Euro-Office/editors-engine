// document: editors-engine/tests/documents/utf8.txt
// The text around the cursor for the system's text input: the paragraph, offsets in UTF-16 units,
// their geometry, placing the cursor and replacing text
function context() { return JSON.parse(eoEngine.getTextContext()); }
t.run("the paragraph's text and the cursor", function () {
	eoEngine.keyDown(36, false, true); // Ctrl+Home
	var text = context();
	t.eq("text", text.text, "Grüße aus Köln ✓");
	t.eq("cursor at the start", [text.start, text.end].join(), "0,0");
	eoEngine.keyDown(35, false, false); // End
	t.eq("cursor at the end", context().start, text.text.length);
	eoEngine.commitText(" 😀x");
	text = context();
	t.eq("an emoji is two units", [text.text.length, text.start].join(), "20,20");
	eoEngine.keyDown(37, false, false); // Left
	eoEngine.keyDown(37, true, false); // Shift+Left: the emoji
	t.eq("selection", [context().start, context().end].join(), "17,19");
});
t.run("placing the cursor and selecting", function () {
	eoEngine.setTextSelection(6, 6);
	t.eq("cursor", [context().start, context().end].join(), "6,6");
	eoEngine.commitText("!");
	t.eq("typed there", context().text.indexOf("Grüße !aus"), 0);
	eoEngine.setTextSelection(7, 10);
	var state = t.state();
	t.eq("selected", [context().start, context().end].join(), "7,10");
	t.ok("the state's selection", state.selection.length > 0);
	t.eq("its text", JSON.parse(eoEngine.copy()).text, "aus");
});
t.run("geometry", function () {
	eoEngine.setTextSelection(3, 3);
	var cursor = t.state().cursor;
	var caret = JSON.parse(eoEngine.getCaretRect(3));
	t.ok("the cursor's place", Math.abs(caret.x1 - cursor.x1) < 0.01 && Math.abs(caret.y1 - cursor.y1) < 0.01 && caret.page === cursor.page);
	t.ok("further right", JSON.parse(eoEngine.getCaretRect(8)).x1 > caret.x1);
	t.eq("the cursor stays", context().start, 3);
	var rects = JSON.parse(eoEngine.getSelectionRects(3, 8));
	t.eq("one area", rects.length, 1);
	t.ok("from the cursor", Math.abs(rects[0].points[0] - caret.x1) < 0.01);
	t.eq("no selection made", t.state().selection.length, 0);
});
t.run("replacing", function () {
	eoEngine.setTextSelection(0, 5);
	eoEngine.replaceText(0, 5, "Hallo");
	var text = context();
	t.eq("replaced", text.text.indexOf("Hallo !aus"), 0);
	t.eq("cursor after it", [text.start, text.end].join(), "5,5");
	eoEngine.replaceText(6, 7, "");
	t.eq("deleted", context().text.indexOf("Hallo aus"), 0);
	eoEngine.undo();
	t.eq("undone in one step", context().text.indexOf("Hallo !aus"), 0);
	t.eq("the next paragraph untouched", documentText().split("\n")[1], "Zweite Zeile");
});
t.done();
