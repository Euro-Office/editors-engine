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
t.noError("spelling");
t.done();
