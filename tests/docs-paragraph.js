// document: editors-engine/tests/documents/utf8.txt
// The paragraph's advanced settings (in the document's text: page breaks and line numbers
// don't apply in shapes)
t.run("advanced paragraph settings", function () {
	["contextualSpacing", "pageBreakBefore", "keepLines", "keepNext", "suppressLineNumbers"].forEach(function (name) {
		eoEngine.setParagraphOption(name, true);
	});
	eoEngine.setParagraphOption("widowControl", false);
	eoEngine.setFirstLineIndent(12.5);
	var format = t.state().format;
	t.eq("on", [format.ContextualSpacing, format.PageBreakBefore, format.KeepLines, format.KeepNext, format.SuppressLineNumbers].join(), "true,true,true,true,true");
	t.eq("orphan control off", format.WidowControl, false);
	t.ok("first line", Math.abs(format.FirstLine - 12.5) < 0.1);
	eoEngine.setParagraphOption("pageBreakBefore", false);
	t.eq("off again", t.state().format.PageBreakBefore, false);
});
t.run("caps", function () {
	eoEngine.keyDown(36, true, false); // Shift+Home: the line
	eoEngine.setCaps(true);
	t.eq("all caps", t.state().format.Caps, true);
	eoEngine.setCaps(false);
	eoEngine.setSmallCaps(true);
	t.eq("small caps", [t.state().format.Caps, t.state().format.SmallCaps].join(), "false,true");
});
t.run("paragraph background color", function () {
	eoEngine.setParagraphShading("FFCC00");
	t.eq("yellow", t.state().format.Shading, "FFCC00");
	var colors = JSON.parse(eoEngine.getThemeColors());
	eoEngine.setParagraphShading("theme:24");
	t.eq("a theme color", t.state().format.Shading, colors.theme[24]);
	eoEngine.setParagraphShading("");
	t.eq("none", t.state().format.Shading, "");
});
t.run("footnote and endnote settings", function () {
	eoEngine.addFootnote();
	eoEngine.endNoteEditing();
	eoEngine.addEndnote();
	eoEngine.endNoteEditing();
	var footnotes = JSON.parse(eoEngine.getNoteSettings(false));
	t.eq("footnotes at first", [footnotes.pos, footnotes.format, footnotes.start, footnotes.restart].join(), "pageBottom,decimal,1,continuous");
	t.eq("endnotes at first", JSON.parse(eoEngine.getNoteSettings(true)).format, "lowerRoman");
	eoEngine.setNoteSettings(false, { "pos": "beneathText", "format": "upperLetter", "start": 3, "restart": "eachPage" });
	footnotes = JSON.parse(eoEngine.getNoteSettings(false));
	t.eq("footnotes set", [footnotes.pos, footnotes.format, footnotes.start, footnotes.restart].join(), "beneathText,upperLetter,3,eachPage");
	eoEngine.setNoteSettings(true, { "pos": "sectEnd", "format": "decimal", "start": 1, "restart": "continuous" });
	t.eq("endnotes set", JSON.parse(eoEngine.getNoteSettings(true)).pos, "sectEnd");
	var document = Asc.editor.WordControl.m_oLogicDocument;
	// The lists as they are now (sdkjs keeps them until it lays the document out again)
	function count(endnotes) {
		document.AllFootnotesList = document.AllEndnotesList = null;
		return (endnotes ? document.GetEndnotesList(null, null) : document.GetFootnotesList(null, null)).length;
	}
	t.eq("a footnote and an endnote", [count(false), count(true)].join(), "1,1");
	eoEngine.convertNotes("swap");
	t.eq("swapped", [count(false), count(true)].join(), "1,1");
	eoEngine.convertNotes("toEndnotes");
	t.eq("all endnotes", [count(false), count(true)].join(), "0,2");
	eoEngine.removeNotes(false, true);
	t.eq("removed", [count(false), count(true)].join(), "0,0");
});
t.done();
