// document: document-templates/sample/sample.docx
// The spelling protocol: requests, answers, the misspelled word at the cursor, replacing it
var bad = { "wrng": ["wrong", "wring"], "speling": ["spelling"] };
function answer() {
	var requests = JSON.parse(eoEngine.takeSpellRequests());
	requests.forEach(function (request) {
		if (request["type"] === "spell")
			request["usrCorrect"] = request["usrWords"].map(function (word) { return !bad[word]; });
		else
			request["usrSuggest"] = request["usrWords"].map(function (word) { return bad[word] || []; });
	});
	if (requests.length)
		eoEngine.spellResults(JSON.stringify(requests));
	return requests.length;
}
t.run("spelling", function () {
	eoEngine.setSpellLanguages([1033]);
	eoEngine.keyDown(36, false, true);
	eoEngine.commitText("This is wrng speling. ");
	for (var round = 0; round < 20 && t.state()["spelling"]["pending"]; round++)
		answer();
	t.eq("all answered", t.state()["spelling"]["pending"], false);
	eoEngine.keyDown(36, false, true);
	eoEngine.keyDown(39, false, true); // after "This"
	eoEngine.keyDown(39, false, true); // after "is"
	eoEngine.keyDown(39, false, false); // into "wrng"
	var word = t.state()["spelling"]["word"];
	t.eq("misspelled word at the cursor", word && word["word"], "wrng");
	answer();
	t.eq("suggestions", JSON.stringify(t.state()["spelling"]["word"]["variants"]), JSON.stringify(["wrong", "wring"]));
	eoEngine.replaceMisspelled("wrong");
	t.ok("replaced", documentText().indexOf("This is wrong speling.") === 0);
});
t.run("text language", function () {
	eoEngine.keyDown(36, false, true);
	eoEngine.keyDown(35, true, true); // Shift+Ctrl+End: all of it
	eoEngine.setTextLanguage(1031);
	t.eq("German", [t.state().format.Lang, t.state().format.LangTag].join(), "1031,de-DE");
	for (var round = 0; round < 20 && t.state()["spelling"]["pending"]; round++)
		answer();
	t.ok("no German dictionary", t.state()["spelling"]["missing"].indexOf(1031) !== -1);
	eoEngine.setSpellLanguages([1033, 1031]);
	t.eq("German dictionary there", t.state()["spelling"]["missing"].indexOf(1031), -1);
});
t.run("document language", function () {
	eoEngine.keyDown(35, false, true); // Ctrl+End
	eoEngine.addFootnote();
	eoEngine.commitText("Fussnote ");
	eoEngine.editHeaderFooter(0, false);
	eoEngine.commitText("Kopfzeile ");
	eoEngine.endHeaderFooter();
	var before = eoEngine.getDocumentLanguage();
	t.eq("applied", eoEngine.setDocumentLanguage(1031), true);
	t.eq("default", eoEngine.getDocumentLanguage(), 1031);
	var paragraphs = editor.WordControl.m_oLogicDocument.GetAllParagraphs({ All: true });
	var text = paragraphs.map(function (paragraph) { return paragraph.GetText(); }).join("|");
	t.ok("with the footnote and the header", text.indexOf("Fussnote") !== -1 && text.indexOf("Kopfzeile") !== -1);
	t.eq("all text German", otherLanguage(paragraphs, 1031), 0);
	eoEngine.undo();
	t.eq("undone", eoEngine.getDocumentLanguage(), before);
});
t.run("document language locked", function () {
	// A paragraph another participant edits (co-editing)
	var logicDocument = editor.WordControl.m_oLogicDocument;
	var paragraph = logicDocument.GetAllParagraphs({ All: true })[0];
	paragraph.Lock.Set_Type(AscCommon.c_oAscLockTypes.kLockTypeOther, false);
	var before = eoEngine.getDocumentLanguage();
	try {
		t.eq("refused", eoEngine.setDocumentLanguage(before === 1036 ? 1031 : 1036), false);
	} finally {
		paragraph.Lock.Set_Type(AscCommon.c_oAscLockTypes.kLockTypeNone, false);
	}
	t.eq("unchanged", eoEngine.getDocumentLanguage(), before);
});
t.run("document language: what changes", function () {
	var logicDocument = editor.WordControl.m_oLogicDocument;
	var types = AscCommon.c_oAscLockTypes;
	t.eq("no language", eoEngine.setDocumentLanguage(0), false);
	t.eq("not a language", eoEngine.setDocumentLanguage("de"), false);
	t.eq("applied", eoEngine.setDocumentLanguage(1031), true);
	// The language it has already: no change, in spite of others' locks
	var paragraphs = logicDocument.GetAllParagraphs({ All: true });
	var steps = logicDocument.History.Points.length;
	paragraphs[0].Lock.Set_Type(types.kLockTypeOther, false);
	try {
		t.eq("nothing to do", eoEngine.setDocumentLanguage(1031), true);
		t.eq("no undo step", logicDocument.History.Points.length, steps);
		// Only what changes needs its lock
		var other = paragraphs[paragraphs.length - 1];
		other.CheckRunContent(function (run) { run.Set_Lang_Val(1036); });
		t.eq("others' paragraph stays out", eoEngine.setDocumentLanguage(1031), true);
		t.eq("the other one changed", otherLanguage([other], 1031), 0);
	} finally {
		paragraphs[0].Lock.Set_Type(types.kLockTypeNone, false);
	}
});
t.run("document language: an exception ends the action", function () {
	var logicDocument = editor.WordControl.m_oLogicDocument;
	var setLang = AscWord.CRun.prototype.Set_Lang_Val;
	AscWord.CRun.prototype.Set_Lang_Val = function () { throw new Error("test"); };
	var thrown = false;
	try {
		eoEngine.setDocumentLanguage(1032);
	} catch (error) {
		thrown = true;
	} finally {
		AscWord.CRun.prototype.Set_Lang_Val = setLang;
	}
	t.ok("thrown", thrown);
	t.eq("action ended", logicDocument.IsActionStarted(), false);
	t.eq("works again", eoEngine.setDocumentLanguage(1031), true);
});
// Every run of [paragraphs] in [lcid]: the count of others
function otherLanguage(paragraphs, lcid) {
	var other = 0;
	paragraphs.forEach(function (paragraph) {
		paragraph.CheckRunContent(function (run) {
			if (run.Get_CompiledPr(false).Lang.Val !== lcid)
				other++;
		});
	});
	return other;
}
t.run("document language in grouped text boxes", function () {
	var logicDocument = editor.WordControl.m_oLogicDocument;
	["Gruppe eins", "Gruppe zwei"].forEach(function (text) {
		eoEngine.keyDown(36, false, true); // Ctrl+Home
		eoEngine.insertTextBox(0, 100, 100);
		eoEngine.enterText(text);
	});
	var boxes = logicDocument.GetAllDrawingObjects().filter(function (drawing) {
		var content = drawing.GraphicObj.getDocContent && drawing.GraphicObj.getDocContent();
		return content && content.GetText().indexOf("Gruppe") >= 0;
	});
	t.eq("two text boxes", boxes.length, 2);
	// A language of their own, as Word sets one on most text (else they'd take the default)
	boxes.forEach(function (drawing) { drawing.GraphicObj.getDocContent().CheckRunContent(function (run) { run.Set_Lang_Val(1049); }); });
	var controller = logicDocument.DrawingObjects;
	controller.resetSelection();
	boxes.forEach(function (drawing) { controller.selectObject(drawing.GraphicObj, drawing.PageNum); });
	eoEngine.group(true);
	var group = logicDocument.GetAllDrawingObjects().filter(function (drawing) { return !!drawing.GraphicObj.spTree; })
		.find(function (drawing) {
			var contents = [];
			drawing.GraphicObj.getAllDocContents(contents);
			return contents.some(function (content) { return content.GetText().indexOf("Gruppe") >= 0; });
		});
	t.ok("grouped", !!group);
	t.eq("applied", eoEngine.setDocumentLanguage(1036), true);
	var contents = [];
	group.GraphicObj.getAllDocContents(contents);
	var paragraphs = [];
	contents.forEach(function (content) { content.GetAllParagraphs({ All: true }, paragraphs); });
	t.eq("the grouped text French", otherLanguage(paragraphs, 1036), 0);
});
t.run("document language with track changes", function () {
	var logicDocument = editor.WordControl.m_oLogicDocument;
	editor.asc_SetTrackRevisions(true);
	try {
		t.eq("applied", eoEngine.setDocumentLanguage(1049), true);
		var paragraphs = logicDocument.GetAllParagraphs({ All: true }).filter(function (paragraph) { return paragraph.bFromDocument; });
		var untracked = 0, runs = 0;
		paragraphs.forEach(function (paragraph) {
			paragraph.CheckRunContent(function (run) {
				runs++;
				if (!run.HavePrChange())
					untracked++;
			});
		});
		t.ok("runs", runs > 1);
		t.eq("all tracked", untracked, 0);
		t.eq("all Russian", otherLanguage(paragraphs, 1049), 0);
		eoEngine.undo();
		var tracked = 0;
		paragraphs.forEach(function (paragraph) {
			paragraph.CheckRunContent(function (run) {
				if (run.HavePrChange())
					tracked++;
			});
		});
		t.eq("undone", tracked, 0);
	} finally {
		editor.asc_SetTrackRevisions(false);
	}
});
t.noError("spelling");
t.done();
