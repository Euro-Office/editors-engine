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
t.done();
