// document: $OUT_DIR/docs-pdf.pdf
// Editing a page's content while co-editing: its pictures go to the Document Server first (the
// app uploads them), then the page is done, with the server's names
var doc = Asc.editor.getPDFDoc();
function images() {
	var list = [];
	(doc.GetPageInfo(0).drawings || []).forEach(function (drawing) {
		if (drawing.getAllRasterImages)
			drawing.getAllRasterImages(list);
	});
	return list;
}

t.run("waits for the pictures", function () {
	var co = window.eoCoState;
	var socket = co.socket;
	// A session (only its being there counts)
	co.socket = {};
	try {
		eoEngine.editPage(0);
	} finally {
		co.socket = socket;
	}
	var names = JSON.parse(eoEngine.imageUploads());
	t.ok("pictures to upload", names.length > 0);
	t.ok("by their files' names", names.every(function (name) { return /^scan-/.test(name); }));
	t.ok("not done yet", images().some(function (image) { return String(image).indexOf("data:") === 0; }));
	eoEngine.finishImageUploads(JSON.stringify(names.map(function (name, index) { return "server" + index + ".png"; })));
	t.eq("none left", eoEngine.imageUploads(), "[]");
	t.ok("the server's names", images().length > 0 && images().every(function (image) { return /^server\d+\.png$/.test(image); }));
	var state = t.state();
	t.eq("without error", state.error, null);
	t.ok("an undo step", state.interface.CanUndo === true);
	eoEngine.undo();
	t.eq("undone", eoEngine.pageOrigin(0), 0);
});
t.done();
