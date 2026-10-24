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
t.run("Enter while a word is composed", function () {
	// Keyboards may send Enter before they commit the word
	eoEngine.keyDown(36, false, true);
	eoEngine.setComposingText("one");
	eoEngine.keyDown(13, false, false);
	eoEngine.setComposingText("two");
	eoEngine.finishComposingText();
	t.eq("each word on its line", documentText().indexOf("one\ntwo"), 0);
	eoEngine.undo();
	eoEngine.undo();
	eoEngine.undo();
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
t.run("theme colors", function () {
	var colors = JSON.parse(eoEngine.getThemeColors());
	t.eq("6 of each of the theme's 10 colors", colors.theme.length, 60);
	t.eq("standard colors", colors.standard.length, 10);
	eoEngine.keyDown(36, false, true); // Ctrl+Home
	eoEngine.keyDown(39, true, true); // Ctrl+Shift+Right: a word
	eoEngine.setTextColor("theme:26"); // accent 1, lighter
	t.eq("the text's color", t.state().format.Color, colors.theme[26]);
	var textPr = Asc.editor.WordControl.m_oLogicDocument.GetCalculatedTextPr();
	t.eq("a color of the theme", textPr.Unifill && textPr.Unifill.fill.color.color.type, Asc.c_oAscColor.COLOR_TYPE_SCHEME);
	var schemes = JSON.parse(eoEngine.getColorSchemes());
	eoEngine.setColorScheme(schemes.current === 1 ? 2 : 1);
	var changed = JSON.parse(eoEngine.getThemeColors());
	t.ok("other theme colors", changed.theme[26] !== colors.theme[26]);
	t.eq("the text's color changed with them", t.state().format.Color, changed.theme[26]);
	eoEngine.setTextColor("C00000");
	t.eq("an RGB color", t.state().format.Color, "C00000");
	eoEngine.undo();
	eoEngine.undo();
	eoEngine.undo();
});
t.run("line spacing and direction", function () {
	eoEngine.keyDown(36, false, true); // Ctrl+Home
	eoEngine.setLineSpacing(2, 8); // exactly 8 mm
	var format = t.state().format;
	t.eq("exactly", format.LineRule, 2);
	t.ok("8 mm", Math.abs(format.Line - 8) < 0.01);
	eoEngine.setLineSpacing(0, 5); // at least 5 mm
	t.eq("at least", t.state().format.LineRule, 0);
	eoEngine.setLineSpacing(1, 1.25);
	t.ok("multiple", t.state().format.LineRule === 1 && Math.abs(t.state().format.Line - 1.25) < 0.01);
	eoEngine.setRtl(true);
	t.eq("right to left", t.state().format.Rtl, true);
	eoEngine.setRtl(false);
	t.eq("left to right", t.state().format.Rtl, false);
	for (var i = 0; i < 5; i++)
		eoEngine.undo();
});
t.run("text direction in shapes", function () {
	eoEngine.insertShape("rect");
	t.eq("horizontal", JSON.parse(eoEngine.drawingColors()).vert, 1);
	eoEngine.setTextVert(4);
	t.eq("rotated up", JSON.parse(eoEngine.drawingColors()).vert, 4);
	eoEngine.setTextVert(3);
	t.eq("rotated down", JSON.parse(eoEngine.drawingColors()).vert, 3);
});
// Draws each preview of a kind into a tile: no exceptions, something drawn
function drawPreviews(kind) {
	var items = JSON.parse(eoEngine.previews(kind));
	items.forEach(function (item, i) {
		eoEngine.beginTile();
		eoEngine.drawTile(-1 - i, 64, 64, 0, 0, 64, 64);
	});
	return items.length;
}
t.run("list pictures", function () {
	t.eq("bullet pictures", drawPreviews("list-bullets"), 7);
	t.eq("number pictures", drawPreviews("list-numbers"), 7);
	t.eq("multilevel pictures", drawPreviews("list-multilevel"), 7);
	var numbering = JSON.parse(eoEngine.previews("list-numbering"));
	t.eq("numbers, then multilevel lists", [0, 6, 7, 13].map(function (i) { return numbering[i].id; }).join(),
		"numbers-0,numbers-6,multilevel-0,multilevel-6");
	t.eq("numbering pictures", drawPreviews("list-numbering"), 14);
});
t.run("style pictures", function () {
	eoEngine.setStyleLabels(JSON.stringify({ "Heading 1": "Überschrift 1" }));
	var styles = JSON.parse(eoEngine.getStyles());
	t.ok("styles", styles.length > 0);
	t.eq("a picture each", drawPreviews("paragraphStyles"), styles.length);
});
t.run("shape fills", function () {
	eoEngine.insertShape("rect");
	eoEngine.setFill("shape", { "type": "gradient", "angle": 45, "stops": [{ "color": "FF0000", "position": 0 }, { "color": "00FF00", "position": 50 }, { "color": "0000FF", "position": 100 }] });
	var fill = JSON.parse(eoEngine.getFill("shape"));
	t.ok("gradient with 3 stops", fill.type === "gradient" && fill.stops.length === 3);
	eoEngine.setFill("shape", { "type": "pattern", "pattern": 0, "foreground": "000000", "background": "FFFFFF" });
	t.eq("pattern", JSON.parse(eoEngine.getFill("shape")).type, "pattern");
	eoEngine.setFill("shape", { "type": "none" });
	t.eq("none", JSON.parse(eoEngine.getFill("shape")).type, "none");
});
t.noError("editing");
t.done();
