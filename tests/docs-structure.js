// document: document-templates/sample/sample.docx
// Tables, outline, statistics, comments
t.run("table", function () {
	eoEngine.keyDown(35, false, true); // Ctrl+End
	eoEngine.insertTable(3, 2);
	t.ok("in the table", t.state()["structure"]["inTable"]);
});
t.run("statistics", function () {
	var statistics = JSON.parse(eoEngine.getStatistics());
	t.ok("words counted", statistics["words"] > 0);
});
t.run("comments", function () {
	eoEngine.keyDown(36, false, true);
	eoEngine.commitText("Commented ");
	eoEngine.keyDown(37, false, true);
	eoEngine.keyDown(37, true, true); // Ctrl+Shift+Left: the word
	eoEngine.setCommentUser("test", "Tester");
	var before = JSON.parse(eoEngine.getComments()).length;
	eoEngine.addComment("A comment");
	var comments = JSON.parse(eoEngine.getComments());
	t.eq("comment added", comments.length, before + 1);
	var added = comments.filter(function (comment) { return comment["text"] === "A comment"; })[0];
	t.ok("the new comment", !!added);
	t.eq("on the word", added["quote"], "Commented");
	// The comments sdkjs shows (on a tap into their text, once the page is drawn) are in the state once
	Asc.editor.sync_ShowComment([added["id"]], 0, 0);
	t.eq("shown", t.state()["shownComments"].join(), added["id"]);
	t.eq("reported once", t.state()["shownComments"].length, 0);
	eoEngine.replyComment(added["id"], "A reply");
	eoEngine.resolveComment(added["id"], true);
	added = JSON.parse(eoEngine.getComments()).filter(function (comment) { return comment["id"] === added["id"]; })[0];
	t.eq("reply", added["replies"].length, 1);
	t.eq("resolved", added["solved"], true);
});
t.run("color schemes", function () {
	var schemes = JSON.parse(eoEngine.getColorSchemes());
	t.ok("listed", schemes["schemes"].length > 5 && schemes["current"] >= 0);
	var other = schemes["current"] === 1 ? 2 : 1;
	eoEngine.setColorScheme(other);
	t.eq("changed", JSON.parse(eoEngine.getColorSchemes())["current"], other);
});
t.run("notes", function () {
	// Closing a note goes back to just after its reference in the text
	[["footnote", eoEngine.addFootnote], ["endnote", eoEngine.addEndnote]].forEach(function (kind) {
		eoEngine.keyDown(35, false, true);
		eoEngine.commitText("Noted ");
		kind[1]();
		eoEngine.commitText("The " + kind[0]);
		t.ok("in the " + kind[0], t.state()["structure"]["inNote"]);
		eoEngine.endNoteEditing();
		t.ok("out of the " + kind[0], !t.state()["structure"]["inNote"]);
		eoEngine.commitText("X");
		// The paragraph's text, references as ^
		var text = "";
		Asc.editor.WordControl.m_oLogicDocument.GetCurrentParagraph().Content.forEach(function (run) {
			(run.Content || []).forEach(function (item) {
				text += item.GetFootnote ? "^" : item.Value ? String.fromCharCode(item.Value) : "";
			});
		});
		t.ok("after the reference (" + kind[0] + ")", /Noted \^X$/.test(text));
	});
});
t.run("document fonts", function () {
	var used = JSON.parse(eoEngine.getDocumentFonts());
	t.ok("listed: " + used.join(), used.length > 0 && used.indexOf("Arial") >= 0);
	t.ok("without the theme's placeholders", used.every(function (name) { return name.charAt(0) !== "+"; }));
});
t.noError("structure");
t.run("delete a chart", function () {
	// A tap selects the part of the chart under it too (here its legend): Delete removes the chart
	var logicDocument = Asc.editor.WordControl.m_oLogicDocument;
	function charts() {
		return logicDocument.GetAllDrawingObjects().filter(function (drawing) {
			return drawing.GraphicObj && drawing.GraphicObj.getObjectType() === AscDFH.historyitem_type_ChartSpace;
		});
	}
	var chart = charts()[0];
	var bounds = chart.GraphicObj.bounds;
	click(chart.PageNum, (bounds.l + bounds.r) / 2, (bounds.t + bounds.b) / 2);
	t.eq("chart selected", t.state()["drawings"].length, 1);
	var before = charts().length;
	eoEngine.keyDown(46, false, false);
	t.eq("chart deleted", charts().length, before - 1);
});
t.done();
