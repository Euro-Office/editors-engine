// document: editors-engine/tests/documents/form.pdf
// Typing into a form's text field one letter at a time, as keyboards commit text
var doc = Asc.editor.getPDFDoc();
t.run("keeps every letter when fonts were asked for meanwhile", function () {
	click(0, 80, 49);
	"Ada ".split("").forEach(eoEngine.commitText);
	// Drawing a tile asks for fonts of characters the field's font lacks (as for U+AC00);
	// the field checks its fonts again before the next letter
	AscFonts.FontPickerByCharacter.getFontsByString("가");
	"Lovelace".split("").forEach(eoEngine.commitText);
	t.eq("its text", doc.GetField("name").content.getAllText(), "Ada Lovelace");
});
t.noError("typing");
t.done();
