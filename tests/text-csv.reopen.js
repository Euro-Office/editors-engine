// The file text-csv.js saved: still with semicolons in Windows-1252
t.eq("encoding", eoEngine.textOptions.encoding, 44);
t.eq("delimiter", eoEngine.textOptions.delimiter, 2);
t.eq("an umlaut", Asc.editor.wb.getWorksheet().model.getCell3(1, 0).getValue(), "Müller");
t.done();
