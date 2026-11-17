// document: document-templates/sample/sample.pptx
// The state of a table on a slide: in it, its style, the cells' fill and borders
var presentation = Asc.editor.WordControl.m_oLogicDocument;
eoEngine.gotoSlide(5);
var frame = presentation.Slides[5].cSld.spTree.filter(function (drawing) {
	return drawing.getObjectType() === AscDFH.historyitem_type_GraphicFrame;
})[0];
t.run("a cell", function () {
	click(5, frame.bounds.l + 5, frame.bounds.t + 3);
	var state = t.state();
	t.ok("in the table", state["structure"]["inTable"]);
	var table = state["format"]["Table"];
	t.eq("its style", table && table["Style"], String(frame.graphicObject.TableStyle));
	t.eq("the cell's fill", table && table["CellFill"], "5982DB");
	var left = table && table["Borders"]["Left"];
	t.ok("its border", !!left && left["Color"] === "000000" && Math.abs(left["Width"] - 0.53) < 0.01);
});
t.run("another style", function () {
	var styles = JSON.parse(eoEngine.previews("tableStyles"));
	eoEngine.setTableStyle(styles[2].id);
	t.eq("in the state", t.state()["format"]["Table"]["Style"], String(styles[2].id));
});
t.run("the table selected", function () {
	var controller = presentation.GetCurrentController();
	controller.resetSelection();
	controller.selectObject(frame, 5);
	var state = t.state();
	t.ok("in the table", state["structure"]["inTable"]);
	t.ok("its properties", !!state["format"]["Table"]);
});
t.run("outside", function () {
	click(5, 5, 5);
	var state = t.state();
	t.ok("not in a table", !state["structure"]["inTable"]);
	t.ok("no properties", !state["format"]["Table"]);
});
t.done();
