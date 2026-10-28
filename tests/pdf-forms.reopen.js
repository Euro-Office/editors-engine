// The form pdf-forms.js filled and saved: the values, the pages, the turned page
var doc = Asc.editor.getPDFDoc();
t.eq("the text field", doc.GetField("name").GetValue(), "Ada");
t.eq("the combo box", doc.GetField("color").GetValue(), "Blue");
t.eq("the list box", doc.GetField("fruit").GetCurIdxs().join(), "1");
t.eq("the pages", eoEngine.getPageCount(), 2);
t.eq("the turned page", Asc.editor.DocumentRenderer.getPageRotate(0), 90);
t.ok("drawn landscape", eoEngine.getPageWidth(0) > eoEngine.getPageHeight(0));
t.noError("the saved form");
t.done();
