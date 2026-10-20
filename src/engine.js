// sdkjs side of the engine, run once after a document is opened (see Document::Open).
// Leaves docbuilder's builder mode, lays out the document and draws tiles into graphics
// objects whose memory the native engine provides.
(function (window) {
	var api = window["Asc"]["editor"];
	var logicDocument = api.WordControl.m_oLogicDocument;
	var drawingDocument = api.WordControl.m_oDrawingDocument;
	var native = window["native"];

	// Builder mode opens documents without layout, interface events or undo history
	api.asc_SetSilentMode(false);
	AscCommon.History.TurnOnChanges();
	api.asc_nativeCalculateFile();

	// Directories for fonts and the document's images; passing a plain object (not the
	// native control) keeps the app image the engine attached to the graphics object
	var resources = {
		"isResourcesObject": true,
		"fontsDirectory": native["GetFontsDirectory"](),
		"imagesDirectory": native["GetImagesPath"]()
	};

	var engine = window["eoEngine"] = {};

	// Graphics object for the next tile; the engine attaches its pixel buffer before drawTile()
	engine["tile"] = null;

	engine["getPageCount"] = function () {
		return drawingDocument.m_lPagesCount;
	};

	engine["getPageWidth"] = function (page) {
		return drawingDocument.m_arrPages[page].width_mm;
	};

	engine["getPageHeight"] = function (page) {
		return drawingDocument.m_arrPages[page].height_mm;
	};

	engine["beginTile"] = function () {
		engine["tile"] = new AscCommon.CNativeGraphics();
	};

	// Draws the area (x, y, width, height) of a page rendered at pageWidth x pageHeight pixels
	engine["drawTile"] = function (page, pageWidth, pageHeight, x, y, width, height) {
		var pageInfo = drawingDocument.m_arrPages[page];
		var mmPerPixelX = pageInfo.width_mm / pageWidth;
		var mmPerPixelY = pageInfo.height_mm / pageHeight;

		var g = engine["tile"];
		g.width = width;
		g.height = height;
		g.create(resources, width, height, width * mmPerPixelX, height * mmPerPixelY);
		g.CoordTransformOffset(-x, -y);
		g.transform(1, 0, 0, 1, 0, 0);

		// Paper
		g.b_color1(255, 255, 255, 255);
		g._s();
		g._m(0, 0);
		g._l(pageInfo.width_mm, 0);
		g._l(pageInfo.width_mm, pageInfo.height_mm);
		g._l(0, pageInfo.height_mm);
		g._z();
		g.df();

		logicDocument.DrawPage(page, g);

		// Releases the engine's app image, not its pixel buffer
		g.Native["Destroy"]();
		engine["tile"] = null;
	};
})(window);
