// document: $OUT_DIR/docs-pdf.pdf
// save: pdf-editpage.pdf
// Editing a page's content (the web PDF editor's "Edit page"): its text as text boxes in the
// fonts installed, its pictures as files, undo, typing; pdf-editpage.reopen.js opens the saved file
var doc = Asc.editor.getPDFDoc();
function drawings() { return doc.GetPageInfo(0).drawings || []; }
function text(drawing) {
	var content = drawing.getDocContent && drawing.getDocContent();
	return content ? content.GetText({ "ParaSeparator": " " }) : "";
}
function textBox(part) {
	return drawings().filter(function (drawing) { return text(drawing).indexOf(part) >= 0; })[0] || null;
}

t.eq("the PDF editor", eoEngine.kind, "pdf");
t.ok("the page can be edited", eoEngine.canEditPage(0));
t.ok("as the state says", t.state().pdf.canEditPage === true);
t.eq("drawn from the file", eoEngine.pageOrigin(0), 0);

t.run("makes the page editable", function () {
	eoEngine.editPage(0);
	var state = t.state();
	t.eq("without error", state.error, null);
	t.ok("the page to draw again", state.dirtyPages[0] === true);
	t.ok("its text in text boxes", textBox("key tools") !== null);
	t.eq("drawn by sdkjs", eoEngine.pageOrigin(0), -1);
	t.ok("not again", !eoEngine.canEditPage(0));
	t.ok("as the state says", t.state().pdf.canEditPage === false);
	t.ok("an undo step", state.interface.CanUndo === true);
});

t.run("has its text in installed fonts", function () {
	var fonts = {};
	drawings().forEach(function (drawing) { drawing.getAllFonts(fonts); });
	t.ok("the file's fonts matched", Object.keys(Asc.editor.embeddedFontsMap || {}).length > 0);
	t.ok("Liberation Sans", fonts["Liberation Sans"] === true);
	t.ok("none of the file's", Object.keys(fonts).every(function (name) { return name.indexOf(AscFonts.getEmbeddedFontPrefix()) !== 0; }));
});

t.run("keeps its pictures as files", function () {
	var images = [];
	drawings().forEach(function (drawing) {
		if (drawing.getAllRasterImages)
			drawing.getAllRasterImages(images);
	});
	t.ok("pictures", images.length > 0);
	t.ok("none as data", images.every(function (image) { return String(image).indexOf("data:") !== 0; }));
	t.ok("files to write", window.eoPdfImages === true);
});

t.run("undoes and redoes it", function () {
	eoEngine.undo();
	t.eq("drawn from the file again", eoEngine.pageOrigin(0), 0);
	t.ok("editable again", eoEngine.canEditPage(0));
	eoEngine.redo();
	t.eq("edited again", eoEngine.pageOrigin(0), -1);
	t.ok("its text boxes", textBox("key tools") !== null);
});

t.run("edits its text", function () {
	var box = textBox("key tools");
	box.Recalculate();
	click(0, box.x + 30, box.y + 3);
	var tapped = t.state();
	t.ok("a cursor at once", tapped.cursor !== null && tapped.cursor.page === 0);
	t.ok("where tapped", tapped.cursor !== null && Math.abs(tapped.cursor.x1 - (box.x + 30)) < 3 && tapped.cursor.y1 < box.y + 3 && tapped.cursor.y2 > box.y + 3);
	t.ok("the text box framed", tapped.textFrame !== null && Math.abs(tapped.textFrame.points[0] - box.x) < 0.5);
	t.eq("not as a selected picture", tapped.drawings.length, 0);
	eoEngine.keyDown(36, false, true);
	eoEngine.commitText("Edited ");
	t.noError("typing");
	t.ok("typed into the text box", text(box).indexOf("Edited ") === 0);
	t.ok("a cursor", t.state().cursor !== null);
});

t.run("formats its text", function () {
	var state = t.state();
	t.ok("a text box", state.pdf.textBox === true);
	t.eq("its font", state.format.FontName, "Liberation Sans");
	t.ok("its size", state.format.FontSize > 0);
	var bold = state.interface.Bold;
	t.ok("whether bold", typeof bold === "boolean");
	// The word typed
	eoEngine.keyDown(39, true, true);
	var selection = t.state().selection;
	t.ok("selected", selection.length > 0);
	var box = textBox("key tools");
	t.ok("on the text box", selection.length > 0 && selection[0].points[0] >= box.x - 1 && selection[0].points[0] <= box.x + box.extX &&
		selection[0].points[1] >= box.y - 1 && selection[0].points[1] <= box.y + box.extY);
	eoEngine.setBold(!bold);
	t.noError("bold");
	t.eq("bold changed", t.state().interface.Bold, !bold);
	t.ok("in the fonts of the document", JSON.parse(eoEngine.getDocumentFonts()).indexOf("Liberation Sans") >= 0);
});

t.done();
