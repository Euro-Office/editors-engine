// document: document-templates/sample/sample.pptx
// The kinds of the selected drawings in the state: shape, group, table, chart
var presentation = Asc.editor.WordControl.m_oLogicDocument;
function kindOf(slide, type) {
	eoEngine.gotoSlide(slide);
	var drawing = presentation.Slides[slide].cSld.spTree.filter(function (item) { return item.getObjectType() === type; })[0];
	var controller = presentation.GetCurrentController();
	controller.resetSelection();
	controller.selectObject(drawing, slide);
	var drawings = t.state().drawings;
	return drawings.length === 1 ? drawings[0].kind : drawings.length + " selected";
}
t.eq("a shape", kindOf(0, AscDFH.historyitem_type_Shape), "shape");
t.eq("a group", kindOf(0, AscDFH.historyitem_type_GroupShape), "group");
t.eq("a table", kindOf(5, AscDFH.historyitem_type_GraphicFrame), "table");
t.eq("a chart", kindOf(3, AscDFH.historyitem_type_ChartSpace), "chart");
t.run("a picture", function () {
	eoEngine.insertImage("missing.png", 100, 50);
	t.eq("inserted", t.state().drawings.map(function (drawing) { return drawing.kind; }).join(), "picture");
});
t.done();
