// document: document-templates/sample/sample.pptx
// save: slides-fill.pptx
// Fills are saved (slides-fill.reopen.js): gradient, pattern and texture shapes, a gradient background
var presentation = Asc.editor.WordControl.m_oLogicDocument;
var fills = [
	{ "type": "gradient", "angle": 90, "stops": [{ "color": "FF0000", "position": 0 }, { "color": "0000FF", "position": 100 }] },
	{ "type": "pattern", "pattern": 6, "foreground": "0000FF", "background": "FFFF00" },
	{ "type": "texture", "texture": 3 }
];
fills.forEach(function (fill) {
	eoEngine.insertShape("rect");
	eoEngine.setFill("shape", fill);
});
eoEngine.setFill("slide", { "type": "gradient", "angle": 0, "stops": [{ "color": "00FF00", "position": 0 }, { "color": "0000FF", "position": 100 }] });
var shapes = presentation.Slides[presentation.CurPage].cSld.spTree;
t.eq("the last shapes have them", shapes.slice(-3).map(function (shape) { return shape.spPr.Fill.fill.type; }).join(),
	[Asc.c_oAscFill.FILL_TYPE_GRAD, Asc.c_oAscFill.FILL_TYPE_PATT, Asc.c_oAscFill.FILL_TYPE_BLIP].join());
t.done();
