// document: editors-engine/tests/documents/empty.txt
// After a script that threw (engine-exception.before.js) the commands still run: with
// JavaScriptCore each script returned "" from then on
eoEngine.commitText("Written");
t.ok("the text", documentText().indexOf("Written") === 0);
t.noError("typing");
t.done();
