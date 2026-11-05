// document: document-templates/sample/sample.pptx
// Typing with a drawing selected (its frame, no text cursor), as in the web editor: a shape takes
// the text into its own, a group ignores it
var presentation = Asc.editor.WordControl.m_oLogicDocument;
function select(drawing) {
	var controller = presentation.GetCurrentController();
	controller.resetSelection();
	controller.selectObject(drawing, 0);
}
var shapes = presentation.Slides[0].cSld.spTree;
t.run("a shape without text", function () {
	var shape = shapes[0];
	select(shape);
	t.eq("selected", t.state().drawings.length, 1);
	eoEngine.commitText("Inside");
	t.eq("its text", shape.getDocContent().GetText(), "Inside\r\n");
	t.eq("typing goes on there", JSON.parse(eoEngine.getTextContext()).text, "Inside");
	t.noError("typing");
});
t.run("a group", function () {
	select(shapes[1]);
	eoEngine.commitText("Lost");
	t.eq("still selected", t.state().drawings.length, 1);
	t.eq("no text cursor", eoEngine.getTextContext(), "null");
	t.noError("typing");
});
t.done();
