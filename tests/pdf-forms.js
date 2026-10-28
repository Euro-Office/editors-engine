// document: editors-engine/tests/documents/form.pdf
// save: pdf-forms.pdf
// A PDF form (text field, combo box, list box in the standard font Helvetica, not embedded):
// filling, choosing options, pages, shapes and erasing ink; pdf-forms.reopen.js opens the saved file
var doc = Asc.editor.getPDFDoc();
function field(name) { return doc.GetField(name); }
t.run("fills forms instead of designing them", function () {
	t.ok("only forms", Asc.editor.isRestrictionForms());
	t.ok("fields not designed", !doc.IsEditFieldsMode());
});
t.run("measures and draws the standard fonts with installed ones", function () {
	function installed(name) {
		var font = {};
		AscFonts.g_fontApplication.GetFontInfo(name, 0, font);
		return font.Name;
	}
	t.eq("Helvetica", installed("Embedded: Helvetica"), installed("Arial"));
	t.eq("Times", installed("Embedded: Times-Roman"), installed("Times New Roman"));
	t.eq("Courier", installed("Embedded: Courier-Bold"), installed("Courier New"));
});
t.run("fills a text field", function () {
	click(0, 80, 49);
	eoEngine.enterText("Ada");
	click(0, 150, 250);
	t.eq("its value", field("name").GetValue(), "Ada");
});
t.run("chooses in a combo box", function () {
	click(0, 70, 92);
	var choice = t.state().pdf.field;
	t.eq("a combo box", choice && choice.type, "comboBox");
	t.eq("its options", choice && choice.options.join(), "Red,Green,Blue");
	t.eq("the one chosen", choice && choice.selected.join(), "0");
	t.ok("where it is", choice && Math.abs(choice.x - 150 * 25.4 / 72) < 1 && Math.abs(choice.y - 252 * 25.4 / 72) < 1);
	eoEngine.selectFieldOption(2);
	t.eq("its value", field("color").GetValue(), "Blue");
	t.noError("choosing");
});
t.run("chooses in a list box", function () {
	click(0, 70, 112);
	var choice = t.state().pdf.field;
	t.eq("a list box", choice && choice.type, "listBox");
	t.eq("its options", choice && choice.options.join(), "Apple,Banana,Cherry");
	eoEngine.selectFieldOption(2);
	eoEngine.selectFieldOption(1);
	t.eq("one chosen", field("fruit").GetCurIdxs().join(), "1");
	click(0, 150, 250);
	t.eq("no field to choose in", t.state().pdf.field, null);
});
t.run("inserts and deletes pages", function () {
	eoEngine.insertPage(1);
	t.eq("a page more", eoEngine.getPageCount(), 2);
	t.ok("laid out again", t.state().layoutChanged);
	t.ok("of the size of the one before", Math.abs(eoEngine.getPageHeight(1) - eoEngine.getPageHeight(0)) < 0.01);
	eoEngine.undo();
	t.eq("undone", eoEngine.getPageCount(), 1);
	eoEngine.deletePage(0);
	t.eq("not the last page", eoEngine.getPageCount(), 1);
	eoEngine.insertPage(1);
	eoEngine.insertPage(2);
	eoEngine.deletePage(2);
	t.eq("deleted", eoEngine.getPageCount(), 2);
});
t.run("turns a page", function () {
	var width = eoEngine.getPageWidth(0), height = eoEngine.getPageHeight(0);
	eoEngine.rotatePage(0, 90);
	t.eq("turned", eoEngine.pageRotation(0), 90);
	t.ok("landscape", Math.abs(eoEngine.getPageWidth(0) - height) < 0.01 && Math.abs(eoEngine.getPageHeight(0) - width) < 0.01);
	eoEngine.undo();
	t.eq("undone", eoEngine.pageRotation(0), 0);
	eoEngine.redo();
	t.eq("redone", eoEngine.pageRotation(0), 90);
	t.noError("turning");
});
t.run("inserts a shape", function () {
	eoEngine.setCurrentPage(1);
	var count = doc.GetPageInfo(1).drawings.length;
	eoEngine.insertShape("ellipse");
	t.eq("a shape", doc.GetPageInfo(1).drawings.length, count + 1);
	t.ok("selected", t.state().pdf.drawing);
	t.ok("no longer adding", !Asc.editor.isStartAddShape);
});
t.run("erases ink", function () {
	var inks = function () { return doc.annots.filter(function (annot) { return annot.IsInk(); }).length; };
	eoEngine.startInk("E53935", 0.7);
	eoEngine.mouse(0, 1, 50, 200, 1, false, false);
	eoEngine.mouse(1, 1, 60, 210, 1, false, false);
	eoEngine.mouse(2, 1, 70, 200, 1, false, false);
	eoEngine.stopInk();
	t.eq("an ink annotation", inks(), 1);
	eoEngine.startInkEraser();
	t.ok("erasing", t.state().pdf.inkEraser);
	eoEngine.mouse(0, 1, 60, 210, 1, false, false);
	eoEngine.mouse(2, 1, 60, 210, 1, false, false);
	t.eq("erased", inks(), 0);
	eoEngine.stopInk();
	t.ok("no longer erasing", !t.state().pdf.inkEraser && !t.state().pdf.ink);
});
t.noError("the PDF form");
t.done();
