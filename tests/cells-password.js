// document: document-templates/sample/sample.xlsx
// save: cells-password.ods
// env: EO_SAVE_PASSWORD=Geheim-1
// reopen env: EO_PASSWORD=Geheim-1
// Saved as ODF with a new password (Document::SetPassword); cells-password.reopen.js opens it with it
eoEngine.selectCells(20, 50, 20, 50);
eoEngine.setCellText("encrypted");
t.eq("entered", Asc.editor.wb.getWorksheet().model.getCell3(50, 20).getValue(), "encrypted");
t.done();
