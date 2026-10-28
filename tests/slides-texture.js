// document: document-templates/sample/sample.pptx
// env: TEMP=/nonexistent
// A texture on the slide's background and a shape is drawn without a temporary directory of the
// process's (as on Android): core gave up on the texture's data URL there
var presentation = Asc.editor.WordControl.m_oLogicDocument;
eoEngine.insertShape("rect");
eoEngine.setFill("shape", { "type": "texture", "texture": 3 });
eoEngine.setFill("slide", { "type": "texture", "texture": 5 });
t.eq("the slide's texture", presentation.Slides[presentation.CurPage].cSld.Bg.bgPr.Fill.fill.type, Asc.c_oAscFill.FILL_TYPE_BLIP);
// The slide as a tile of the app
eoEngine.beginTile();
eoEngine.drawTile(presentation.CurPage, 320, 180, 0, 0, 320, 180);
t.ok("drawn", true);
t.done();
