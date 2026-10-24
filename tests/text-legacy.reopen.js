// The file text-legacy.js saved: x2t writes txt in UTF-8 (with a byte order mark)
t.eq("encoding", eoEngine.textOptions.encoding, 46);
t.ok("the typed and the old text", documentText().indexOf("Saved Grüße aus Köln – 5 €") === 0);
t.done();
