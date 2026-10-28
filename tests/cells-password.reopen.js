// The file cells-password.js saved, opened with its password (it doesn't open without one)
t.eq("the saved file has the value", Asc.editor.wb.getWorksheet().model.getCell3(50, 20).getValue(), "encrypted");
t.done();
