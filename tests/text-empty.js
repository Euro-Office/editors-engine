// document: editors-engine/tests/documents/empty.txt
// save: text-empty.txt
// An empty text file opens (x2t converts none: the engine opens a copy with one empty line)
eoEngine.commitText("Written");
t.noError("typing");
t.done();
