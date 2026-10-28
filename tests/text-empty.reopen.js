// The file text-empty.js saved: its text
var paragraph = Asc.editor.WordControl.m_oLogicDocument.Content[0];
t.eq("the text", paragraph.GetText().trim(), "Written");
t.done();
