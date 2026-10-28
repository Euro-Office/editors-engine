// document: editors-engine/tests/documents/utf16le.txt
// UTF-16 without a byte order mark
t.eq("encoding", eoEngine.textOptions.encoding, 48);
t.ok("the text", documentText().indexOf("Hello UTF-16 without a mark\nÄ second line") === 0);
t.done();
