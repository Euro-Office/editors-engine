// document: editors-engine/tests/documents/windows-1251.txt
// env: EO_ENCODING=14
// The encoding the user chose
t.eq("encoding", eoEngine.textOptions.encoding, 14);
t.ok("the text", documentText().indexOf("Привет, мир") === 0);
t.done();
