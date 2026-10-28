// document: editors-engine/tests/documents/utf8.txt
// Plain text in UTF-8 without a byte order mark (x2t opens it only with its encoding)
t.eq("encoding", eoEngine.textOptions.encoding, 46);
t.ok("the text", documentText().indexOf("Grüße aus Köln ✓") === 0);
t.done();
