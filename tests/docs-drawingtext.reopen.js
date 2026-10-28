// The file docs-drawingtext.js saved
var texts = Asc.editor.WordControl.m_oLogicDocument.GetAllDrawingObjects().map(function (drawing) {
	var content = drawing.GraphicObj.getDocContent && drawing.GraphicObj.getDocContent();
	return content ? content.GetText() : "";
});
t.eq("the text next to the picture", documentText().indexOf("Logo Text Editors"), 0);
t.ok("the shape's text", texts.indexOf("Inside\r\n") >= 0);
t.done();
