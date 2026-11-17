// document: editors-engine/tests/documents/utf8.txt
// Text positions at points (getOffsetAt) and the cursor lines of several offsets (getCaretRects),
// for the system's text input; the cursor stays
function context() { return JSON.parse(eoEngine.getTextContext()); }
t.run("offsets at the cursor lines", function () {
	eoEngine.keyDown(36, false, true); // Ctrl+Home
	eoEngine.setTextSelection(2, 2);
	var offsets = [0, 3, 8, context().text.length];
	var rects = JSON.parse(eoEngine.getCaretRects(offsets));
	t.eq("a line each", rects.length, offsets.length);
	t.ok("as getCaretRect", Math.abs(rects[2].x1 - JSON.parse(eoEngine.getCaretRect(8)).x1) < 0.01);
	t.eq("back to the offsets", rects.map(function (rect) {
		return eoEngine.getOffsetAt(rect.page, rect.x1 + 0.1, (rect.y1 + rect.y2) / 2);
	}).join(), offsets.join());
	t.eq("the cursor stays", [context().start, context().end].join(), "2,2");
	t.eq("no selection made", t.state().selection.length, 0);
});
t.run("outside the paragraph", function () {
	var line = JSON.parse(eoEngine.getCaretRect(0));
	t.eq("left of it", eoEngine.getOffsetAt(line.page, 0, (line.y1 + line.y2) / 2), 0);
	t.eq("right of it", eoEngine.getOffsetAt(line.page, 200, (line.y1 + line.y2) / 2), context().text.length);
	t.eq("a later page", eoEngine.getOffsetAt(line.page + 1, 10, 10), context().text.length);
});
t.done();
