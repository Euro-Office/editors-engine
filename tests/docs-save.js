// document: document-templates/sample/sample.docx
// save: docs-save.docx
// Typed text is saved (docs-save.reopen.js checks the saved file)
eoEngine.keyDown(36, false, true);
eoEngine.commitText("Saved by the engine test ");
t.ok("typed", documentText().indexOf("Saved by the engine test ") === 0);
t.done();
