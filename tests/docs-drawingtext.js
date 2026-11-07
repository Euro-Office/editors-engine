// document: document-templates/sample/sample.docx
// save: docs-drawingtext.docx
// Typing with a drawing selected (its frame, no text cursor): a shape takes the text into its own
// (docs-drawingtext.reopen.js checks the saved file), a picture leaves it for the text next to it
var logicDocument = Asc.editor.WordControl.m_oLogicDocument;
function drawings(type) {
	return logicDocument.GetAllDrawingObjects().map(function (drawing) { return drawing.GraphicObj; })
		.filter(function (drawing) { return drawing.getObjectType() === type; });
}
function shapeText(shape) {
	return shape.getDocContent() ? shape.getDocContent().GetText().replace(/\r\n$/, "") : null;
}
t.run("a picture", function () {
	click(0, 40, 17); // "Your Logo"
	t.eq("selected", t.state().drawings.length, 1);
	eoEngine.commitText("Logo ");
	t.eq("all of the text next to it", documentText().indexOf("Logo Text Editors"), 0);
	t.eq("typed in the text", JSON.parse(eoEngine.getTextContext()).text.indexOf("Logo "), 1);
	t.noError("typing");
});
t.run("a shape without text", function () {
	var shape = drawings(AscDFH.historyitem_type_Shape).filter(function (drawing) { return !drawing.getDocContent(); })[0];
	logicDocument.RemoveSelection();
	logicDocument.DrawingObjects.selectObject(shape, 0);
	logicDocument.SetDocPosType(3);
	t.eq("selected", t.state().drawings.length, 1);
	eoEngine.commitText("Inside");
	t.eq("its text", shapeText(shape), "Inside");
	t.eq("typing goes on there", JSON.parse(eoEngine.getTextContext()).text, "Inside");
	t.noError("typing");
});
t.done();
