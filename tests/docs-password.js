// document: document-templates/sample/sample.docx
// save: docs-password.docx
// env: EO_SAVE_PASSWORD=Geheim-1
// reopen env: EO_PASSWORD=Geheim-1
// Saved with a new password (Document::SetPassword); docs-password.reopen.js opens it with it
eoEngine.keyDown(36, false, true);
eoEngine.commitText("Encrypted ");
t.ok("typed", documentText().indexOf("Encrypted ") === 0);
t.done();
