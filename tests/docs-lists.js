// document: editors-engine/tests/documents/utf8.txt
// save: docs-lists.docx
// A list preset applied (in a promise, so it is checked in the saved file: docs-lists.reopen.js)
// A new paragraph at the end, in plain text: paragraphs with indents of their own keep them in
// lists, which then aren't the preset's any more
eoEngine.keyDown(35, false, true); // Ctrl+End
eoEngine.keyDown(13, false, false);
eoEngine.commitText("List item");
eoEngine.setListPreset("multilevel", 1);
eoEngine.restartNumbering();
eoEngine.continueNumbering();
t.noError("lists");
t.done();
