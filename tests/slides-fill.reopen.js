// The file slides-fill.js saved
var presentation = Asc.editor.WordControl.m_oLogicDocument;
var slide = presentation.Slides[0];
var shapes = slide.cSld.spTree;
t.eq("the shapes' fills", shapes.slice(-3).map(function (shape) { return shape.spPr.Fill.fill.type; }).join(),
	[Asc.c_oAscFill.FILL_TYPE_GRAD, Asc.c_oAscFill.FILL_TYPE_PATT, Asc.c_oAscFill.FILL_TYPE_BLIP].join());
t.eq("the background's", slide.cSld.Bg && slide.cSld.Bg.bgPr && slide.cSld.Bg.bgPr.Fill.fill.type, Asc.c_oAscFill.FILL_TYPE_GRAD);
t.ok("the texture's picture", shapes[shapes.length - 1].spPr.Fill.fill.RasterImageId.length > 0);
t.done();
