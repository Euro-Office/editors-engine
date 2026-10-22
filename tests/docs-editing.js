// document: document-templates/sample/sample.docx
// Typing, undo and redo, keyboard shortcuts, mouse selection
var blocks = JSON.parse(eoEngine.textBlocks(0));
t.ok("text blocks on page 1", blocks.length > 0);
t.run("typing", function () {
	eoEngine.keyDown(36, false, true); // Ctrl+Home
	eoEngine.commitText("Engine test ");
	t.ok("text typed at the start", documentText().indexOf("Engine test ") === 0);
	t.ok("modified", t.state()["modified"]);
	eoEngine.keyDown(90, false, true); // Ctrl+Z
	t.ok("undone", documentText().indexOf("Engine test") < 0);
	eoEngine.keyDown(89, false, true); // Ctrl+Y
	t.ok("redone", documentText().indexOf("Engine test ") === 0);
});
t.run("shortcuts", function () {
	eoEngine.keyDown(36, false, true);
	eoEngine.keyDown(39, true, true); // Ctrl+Shift+Right: a word
	t.ok("word selected", t.state()["selection"].length > 0);
	eoEngine.keyDown(66, false, true); // Ctrl+B
	t.eq("bold", t.state()["interface"]["Bold"], true);
});
t.run("mouse", function () {
	// A paragraph of body text (the first ones of the sample are in shapes)
	var block = blocks.reduce(function (a, b) { return b.text.length > a.text.length ? b : a; });
	var y = (block.top + block.bottom) / 2;
	click(0, block.left + 1, y);
	t.eq("click clears the selection", t.state()["selection"].length, 0);
	eoEngine.mouse(0, 0, block.left + 30, y, 1, false, true); // Shift+click
	eoEngine.mouse(2, 0, block.left + 30, y, 1, false, true);
	t.ok("Shift+click extends the selection", t.state()["selection"].length > 0);
});
t.run("adds a text box", function () {
	eoEngine.insertTextBox(0, 100, 100);
	eoEngine.enterText("A text box");
	t.ok("the text in it", Asc.editor.WordControl.m_oLogicDocument.GetAllDrawingObjects().some(function (drawing) {
		var content = drawing.GraphicObj.getDocContent && drawing.GraphicObj.getDocContent();
		return content && content.GetText().indexOf("A text box") >= 0;
	}));
});
t.run("formats a selected chart's text", function () {
	eoEngine.insertChart(0);
	t.ok("the chart is selected", t.state().drawings.length > 0);
	var bold = !!t.state().interface.Bold;
	eoEngine.setBold(!bold);
	t.eq("its bold is reported", !!t.state().interface.Bold, !bold);
	eoEngine.setBold(bold);
	t.eq("and back", !!t.state().interface.Bold, bold);
});
t.noError("editing");
t.done();
