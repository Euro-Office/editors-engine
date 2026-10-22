// document: document-templates/sample/sample.pptx
// Slides: list, add, duplicate, delete, text for screen readers
t.run("slides", function () {
	var count = JSON.parse(eoEngine.getSlides()).length;
	t.ok("slides", count > 0);
	eoEngine.addSlide();
	t.eq("added", JSON.parse(eoEngine.getSlides()).length, count + 1);
	eoEngine.duplicateSlide();
	t.eq("duplicated", JSON.parse(eoEngine.getSlides()).length, count + 2);
	eoEngine.deleteSlide();
	eoEngine.deleteSlide();
	t.eq("deleted", JSON.parse(eoEngine.getSlides()).length, count);
	t.ok("text on slide 1", JSON.parse(eoEngine.textBlocks(0)).length > 0);
});
t.run("adds a text box", function () {
	eoEngine.gotoSlide(0);
	var presentation = Asc.editor.WordControl.m_oLogicDocument;
	eoEngine.insertTextBox(presentation.CurPage, 100, 60);
	var box = presentation.GetCurrentController().getSelectedArray()[0];
	t.ok("centered on the point", box && Math.abs(box.x + box.extX / 2 - 100) < 1 && Math.abs(box.y + box.extY / 2 - 60) < 10);
	eoEngine.enterText("A text box");
	t.ok("the text in it", Asc.editor.WordControl.m_oLogicDocument.Slides.some(function (slide) {
		return slide.cSld.spTree.some(function (shape) {
			var content = shape.getDocContent && shape.getDocContent();
			return content && content.GetText().indexOf("A text box") >= 0;
		});
	}));
});
t.run("formats a selected chart's text", function () {
	eoEngine.insertChart(0);
	t.ok("the chart is selected", t.state().drawings.length > 0);
	var bold = !!t.state().interface.Bold;
	eoEngine.setBold(!bold);
	t.eq("its bold is reported", !!t.state().interface.Bold, !bold);
	eoEngine.setBold(bold);
	t.eq("and back", !!t.state().interface.Bold, bold);
});
t.noError("slides");
t.done();
