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
	// The comments sdkjs shows (on a tap into their text, once the page is drawn) are in the state
	Asc.editor.sync_ShowComment([added["id"]], 0, 0);
	t.eq("shown", t.state()["shownComments"].join(), added["id"]);
	Asc.editor.sync_HideComment();
	t.eq("hidden", t.state()["shownComments"].length, 0);
	eoEngine.replyComment(added["id"], "A reply");
	eoEngine.resolveComment(added["id"], true);
	added = JSON.parse(eoEngine.getComments()).filter(function (comment) { return comment["id"] === added["id"]; })[0];
	t.eq("reply", added["replies"].length, 1);
	t.eq("resolved", added["solved"], true);
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
