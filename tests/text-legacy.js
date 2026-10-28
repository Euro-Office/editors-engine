// document: editors-engine/tests/documents/windows-1252.txt
// save: text-legacy.txt
// Plain text that isn't UTF-8: Windows-1252 by default
t.eq("encoding", eoEngine.textOptions.encoding, 44);
t.ok("the text", documentText().indexOf("Grüße aus Köln – 5 €") === 0);
eoEngine.keyDown(36, false, true);
eoEngine.commitText("Saved ");
t.done();
