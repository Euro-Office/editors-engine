// document: document-templates/sample/sample.docx
// Mobile view: the text on pages of the screen's width; PDFs keep the document's pages
function laidOut() {
	for (var i = 0; i < 1000 && t.state()["layoutPending"]; i++)
		eoEngine.tick(100);
}
t.run("mobile view", function () {
	var pages = eoEngine.getPageCount();
	eoEngine.setMobileView(true, 70, 130, 1);
	laidOut();
	t.ok("on", t.state()["mobileView"]);
	t.eq("the screen's width", eoEngine.getPageWidth(0), 70);
	t.ok("more pages", eoEngine.getPageCount() > pages);
	eoEngine.keyDown(36, false, true);
	eoEngine.commitText("Mobile ");
	t.ok("typing", Asc.editor.WordControl.m_oLogicDocument.GetText({ ParaSeparator: " " }).indexOf("Mobile Text") === 0);
	t.eq("no pages counted", JSON.parse(eoEngine.getStatistics())["pages"], -1);
	// PDFs: the document's pages
	var pdfPageWidth = null;
	var getPdf = Asc.editor["asc_nativeGetPDF"];
	Asc.editor["asc_nativeGetPDF"] = function () {
		pdfPageWidth = eoEngine.getPageWidth(0);
		return getPdf.apply(this, arguments);
	};
	eoEngine.pdfCommands();
	Asc.editor["asc_nativeGetPDF"] = getPdf;
	t.ok("PDF of A4 pages: " + pdfPageWidth, Math.abs(pdfPageWidth - 210) < 1);
	laidOut();
	t.eq("mobile view after the PDF", eoEngine.getPageWidth(0), 70);
	eoEngine.setMobileView(false);
	laidOut();
	t.ok("off", !t.state()["mobileView"]);
	t.ok("A4 again", Math.abs(eoEngine.getPageWidth(0) - 210) < 1);
});
t.noError("mobile view");
t.done();
