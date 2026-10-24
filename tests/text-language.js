// document: editors-engine/tests/documents/windows-1251.txt
// env: EO_LANGUAGE=ru-RU
// Plain text that isn't UTF-8 in the legacy encoding of the user's language
t.eq("encoding", eoEngine.textOptions.encoding, 14);
t.ok("the text", documentText().indexOf("Привет, мир") === 0);
t.done();
