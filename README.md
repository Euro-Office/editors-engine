# Engine

The C++ engine behind `libeditors`. It runs current sdkjs in core's doctrenderer (V8) and draws pages with core's graphics engine.

```
Kotlin UI (libg*) ── libeditors (EditorEngine, EditorDocument) ── JNI (src/jni) ── eo::Document (src) ── core's docbuilder/doctrenderer + sdkjs
```

## Pieces

| File | Purpose |
|---|---|
| `src/Document.h/.cpp` | `eo::Document`: open a document (x2t converts it, sdkjs lays it out), page count and sizes, draw a tile into a pixel buffer, save |
| `src/engine.js` | Runs in sdkjs after opening (embedded as `engine_js.h`): leaves docbuilder's builder mode, lays out the document, draws tiles |
| `src/pdf.js` | Runs after `engine.js` for PDFs (embedded as `pdf_js.h`): sdkjs' PDF editor in the engine, see [PDFs](#pdfs) |
| `src/DrawingDocument.h/.cpp` | `eo::DrawingDocument`: PDF, XPS and DjVu through core's readers (PdfFile, XpsFile, DjVuFile), no sdkjs: pages, tiles, PDF passwords; the pages under sdkjs' PDF editor and saving its changes |
| `src/jni/DocumentJni.cpp` | JNI for `lib.editors.base.engine.NativeEngine` (Android only); draws into `Bitmap`s |
| `tools/render.cpp` | Desktop check: renders page 1 whole and from tiles, compares both and saves PNGs |

## How it works

- **Opening.** `CDocBuilder` opens the file: x2t converts it to sdkjs' format, then doctrenderer loads sdkjs with the document. On Android, x2t runs in-process through `CDocBuilder::SetX2tConverter`, because apps can't start the x2t executable.
- **Builder mode.** docbuilder opens documents for scripting: no layout, no interface events, no undo. `engine.js` switches those back on and lays the document out.
- **Drawing.** sdkjs draws a page into `CNativeGraphics`, which is core's `CGraphicsEmbed`. The engine attaches its own `CGraphicsAppImage` to the graphics object, so sdkjs draws straight into the caller's buffer (an Android bitmap). The app image also provides fonts loaded once and an image cache shared by all tiles of a document.
- **Saving.** `CDocBuilder::SaveFile` takes the edited document from sdkjs and x2t converts it to the target format (docx, odt, rtf, txt, pdf, ...; not doc). The app saves into a temporary file first and then replaces the document. Editing continues afterwards: after a PDF export, docbuilder turns builder mode's silent mode back on and lays the document out again, so `engine.js` restores the interface events and the cursor.
- **Layout.** Like the web editor, sdkjs lays out the first pages when a document opens and the others on timers, and after an edit lays out only what changed before continuing on timers. `engine.js` gives sdkjs a timer queue (native.js ignores timers); the app runs it in slices of 30 ms (`EditorDocument.tick`) while `layoutPending` is true. Input waits for one slice at most, and the first page shows without waiting for the whole document.
- **Errors.** Commands run in try/catch; an exception in sdkjs comes back in the state (`error`) and the app logs it.
- **Threading.** sdkjs is single-threaded. A document is created, used and closed on one thread (`EditorEngine.dispatcher` on Android).

## Runtime files

The runtime directory (`Document::Initialize`) contains:
- `DoctRenderer.config`
- `sdkjs/`: `word/sdk-all-min.js`, `word/sdk-all.js`, `common/Native/*.js`, `common/libfont/engine/fonts_native.js`, `pdf/src/engine/drawingfile_native.js`, `vendor/xregexp-all-min.js`
- `empty/new.docx`: the blank document the PDF editor's context starts from (document-templates' `new/en-US/new.docx`)
- `bundled-fonts/`: Liberation, Carlito, Caladea and Open Sans, the open fonts with the metrics of Arial, Times New Roman, Courier New, Calibri and Cambria
- `fonts/`: the font index (`AllFonts.js`, `font_selection.bin`)

On Android, `libeditors` packs these files into the APK. `EditorEngine` unpacks them on first use and generates the font index from the bundled fonts and `/system/fonts`.

## Desktop check

With core built for the host (see `spike/m1/README.md` on the `spike/m1-engine` branch):

The host's font index must be in `<runtime dir>/fonts/` (`allfontsgen --input=<core-fonts> --allfonts=<dir>/fonts/AllFonts.js --selection=<dir>/fonts/font_selection.bin`); without it, pages render without text. `eo-render` runs the scripts given after the scale, and saves the document to any other path given there (`out/saved.docx`).

```sh
cmake -S engine -B build -G Ninja -DCORE_SOURCE_DIR=<core> -DCORE_LIBS_DIR=<core package dir> -DEO_ENGINE_TOOLS=ON
cmake --build build
LD_LIBRARY_PATH=<core package dir> build/eo-render <runtime dir> document.docx out/
```

## Measured

Opening, after the first start (which unpacks the runtime and indexes the fonts, ~1 s); `EditorEngine` logs each step (logcat `EditorEngine`, `EditorViewer`):

| | Desktop (x86_64) | Emulator (x86_64) |
|---|---|---|
| Load the native libraries | – | 0.3–0.4 s |
| `sample.docx` (1 page, images, shapes): convert, load, layout | 0.07 + 0.36 + 0.23 s | 0.07 + 0.5–0.6 + 0.3 s |
| `sample.docx`: render page 1 | 230 ms | 320 ms |
| 95-page text document: convert, load, layout of page 1 | 0.06 + 0.68 + 0.21 s | 0.03 + 0.9–1.0 + 0.29 s |
| 95-page text document: layout of the other pages, in slices | 0.86 s | – |
| 95-page text document: Enter on page 1 | 26 ms (212 ms laying out everything) | – |

- **Loading sdkjs** uses V8's code cache (`sdkjs/word/sdk-all.cache`, written by doctrenderer on the first start): 2.0 s without it, 0.5–0.6 s with it on the emulator.
- **V8 startup snapshot** (doctrenderer's `sdk-all.bin`, the role of ONLYOFFICE's `libbootstrap`): tried and left out. It has to be created on the device (it belongs to the V8 build), takes 1.3 s and 6.8 MB, and saved only 50–70 ms per open over the code cache: most of the remaining time is sdkjs reading the document and compiling functions on first use, which neither covers. A damaged snapshot file would also crash V8 on every start.

## Spreadsheets

`engine.js` has its own adapter for spreadsheets (`spreadsheetEngine`), started from the step 5 spike.

- **Drawing.** The active sheet is one page: its used cells plus empty ones to type into. Tiles are drawn by the print path: `WorksheetView.drawForPrint` with a print page (`CPagePrint`) made of the cells under the tile, into the tile's `CNativeGraphics`. Values, formats, table styles, pivot tables, charts and slicers render. `asc_nativeCalculateFile()` after opening prepares the drawing objects.
- **Geometry.** The column and row boundaries (mm) come with the state when they change; the app draws the headings and the selection from them and maps taps to cells (`SheetView`).
- **Editing.** The web cell editor (`CellEditor`) and the events controller depend on the DOM, so cells are edited in a native field and committed with `WorksheetView._saveCellValueAfterEdit(range, [Fragment])`, the cell editor's own commit (formulas, recalculation and undo work). `selectCells(..., enterText)` enters and moves in one command, so the state reports both.
- **Commands.** `selectCells`, `setCellText`, `clearCells`, `setActiveSheet`, the toolbar commands (`asc_setCellBold`, `asc_setCellAlign`, ... with the paragraph alignment values), undo/redo, copy/cut/paste and saving (xlsx, xlsm, xltx, xltm, ods, ots, csv). `getState` has the fields of the text editors' state plus `sheet`.
- **Known:** wrapped text in a row with a fixed height runs into the next row (the print path doesn't clip it); a single page of a very large sheet (thousands of pixels each way) loses table styles, which tiles don't.

## PDFs

PDFs (other than ONLYOFFICE's forms, which docbuilder opens in the document editor) open in sdkjs' PDF editor (`PDFEditorApi`), as in the web editor: annotations (markups, ink, notes, text boxes, stamps), comments, pictures and shapes, form fields, search, and co-editing. docbuilder doesn't open PDFs, so `Document::OpenPdf` does it the way x2t saves PDFs on the server:

- **Opening.** docbuilder opens a blank document, whose context has the PDF editor (it is part of the document editor's scripts). The engine loads `drawingfile_native.js` (the native counterpart of the web editor's WebAssembly reader) and registers core's reader for it (`CDrawingFileEmbed`, created with the engine's fonts); `pdf.js` opens a copy of the file with it, creates the `PDFEditorApi` and opens the document (`asc_nativeOpenFile`, as doctrenderer does for "pdf"). Objects are numbered from 0, as in the web editors, so co-editing works.
- **The viewer.** sdkjs' viewer (`CHtmlPage`) is made for a browser page. `pdf.js` gives it a fixed layout (all pages "visible", zoom 4) and replaces its painting: the pages it would paint again come with the state (`dirtyPages`, from its pages' redraw flags). Touches are passed on as its mouse handlers pass them, at the viewer's pixels for the page millimeters. The text of pages, for selecting, marking up and searching, comes from core's reader (`drawingfile_native.js` leaves it out).
- **Drawing.** `Document::RenderTile` draws the page from the file with core's reader without its annotations and form fields (`DrawingDocument::RenderTile`), then sdkjs' objects over it: added pictures, shapes and text boxes, annotations and fields, as `CHtmlPage.GetPrintPage` draws them. doctrenderer's graphics clear their buffer, so sdkjs draws into a buffer of its own, which goes over the page by its opacity. Annotations draw on a canvas (`CPDFGraphics`); a small canvas (`NativeCanvas` in `pdf.js`) takes their paths to the engine's graphics. They are drawn from their properties: in a browser, unchanged ones are pictures of their appearance streams, which the engine has no way to draw.
- **Saving.** sdkjs' changes are edit commands (`CHtmlPage.Save`), which core applies to the original file (`CPdfFile::EditPdf`, `AddToPdfFromBinary`), as x2t does on the server: an incremental update. Added pictures go into the pages' content.
- **Commands.** Those of the text editors where they apply (touches, keys, text, selection, copy, undo/redo, search, comments, outline), plus `markup(kind, color)`, `startInk(color, width)`/`stopInk()`, `addFreeText()`, `placeImage(...)` (a drawn signature), `deleteSelection()`, `setCurrentPage(page)` and `getFileOutline()`. The state has `pdf` (the pen, the selected annotation) and `navigate` (a place to show after a link or an entry of the contents).
- **Co-editing.** As for documents: the server's file (`Editor.bin` or `origin.pdf`) is opened again from where the first open started numbering, then the session's changes are applied (`_openDocumentEndCallback`), and the engine starts again on it. Viewers are PDF viewers (`asc_setPdfViewer`), not in view mode: they fill in forms.

## Tests

`tests/` has regression tests: scripts that run on document-templates' samples with `eo-render` and check the results (`lib.js` has the assertions). `tests/run.sh` runs them; how to build `eo-render` for the host is in AndroidEditors' `build/scripts/engine-host.sh`.

## Own repository

The engine has no Android code outside `src/jni/` and builds on its own (CMake, against core), so it can be shared with other platforms (an iOS app, with core's JavaScriptCore backend instead of V8). To move it into a repository of its own, keeping its history:

```sh
git clone https://github.com/Euro-Office/editors-android engine-repo && cd engine-repo
git filter-repo --subdirectory-filter engine
```

Then:
- `third_party/hunspell` becomes a submodule of the new repository (`.gitmodules` with `path = third_party/hunspell`).
- editors-android takes the new repository as a submodule at `engine/`, so `libeditors` (`path("../engine/CMakeLists.txt")`) and AndroidEditors' scripts keep their paths.
- The JNI binding (`src/jni/`) can stay in the engine repository behind `if(ANDROID)`, or move to `libeditors`.

## Co-editing

Documents, presentations and spreadsheets of an integration (Nextcloud with the Euro-Office connector) are co-edited through the Document Server, with sdkjs' own co-authoring client (DocsCoApi), like in the web editors. `engine.js` (`coEditingCommands`):

- **Socket:** sdkjs takes `window.io` as its socket.io client. The engine's socket queues what sdkjs sends (`coTakeOutbox`); the app carries it over socket.io (path `<server>/doc/<key>/c`, sdkjs' `auth` options) and passes the server's events back (`coReceive`). The app's socket reconnects with sdkjs' settings (`reconnection`) and the tokens sdkjs changes (`auth`); sdkjs then authenticates again and catches up.
- **Opening:** `coOpen(config)` with the editor configuration of the integration (`/ocs/v2.php/apps/eurooffice/api/v1/config/<fileId>`). After the license, sdkjs opens the document; the server sends `documentOpen` with the URL of its `Editor.bin`. The app downloads it first and tells the engine (`coSetFile`), because sdkjs would load it over the web.
- **Object ids:** changes name the objects they change by id, so a client must give the objects the ids the web editors give. The web editors number objects from 0 until the user is known and load the document right after creating the table of objects (id 1), so the engine loads the server's version from id 1 too, with the same sdkjs code; the table of objects keeps its id: changes that add objects are addressed to it. The co-editing check compares the ids of the last objects both loaded. The document is a new object then: the engine starts again on it (`eoStartEngine`, `coTakeReloaded` tells the app). The web editor's page code that runs on the way (presentations: panes, zoom, thumbnails) is skipped or fails harmlessly.
- **Changes** go to the server once a second (`coTick`, the web editors' 40 ms interval); docbuilder's redirection of changes to itself is undone. Timers keep their delays: sdkjs gives up waiting for the server's answers (locks, saving) after one.
- **Session:** `coEditingState` (also in the state) has the participants, others' cursors (page millimeters) and the connection (reconnecting, or disconnected: sdkjs only views then). Parts others locked are framed in red.
- **Pictures:** sdkjs learns the URLs of the document's pictures and of those others add; the app downloads them into the images directory (outbox `fetch`, then `coImageLoaded`). A picture to insert is uploaded to the server first (`coUploadInfo`: `POST <server>/upload/<documentId>`, bearer token), then inserted by the name the server gave it (`coAddUrls`, `insertImage`).

`tools/coedit/check.mjs` checks all this on the host: the engine (`eo-render` with `EO_REPL=1`, one script per line, `engine.mjs`) and a web editor (Playwright, `web.mjs`) edit a document together, both ways: text, pictures, comments, others' cursors and selections, others' locks framed in red (`!render <page> <png>` in the REPL draws a page and counts the lock's red), a viewer that gets the changes as they come (a second engine) and a connection that drops for good; then the document the Document Server saved must have both's edits. A small storage (`storage.mjs`) stands in for the integration: it serves the documents, signs editor configurations with the server's secret and takes the server's callback. With a Document Server on port 8090 (for example the development environment of DocumentServer) that reaches this machine at `<host>`:

```sh
cd editors-android/engine/tools/coedit && npm ci && npx playwright install chromium && cd -
export RUN_ENGINE="docker run -i --rm --network host --user $(id -u):$(id -g) -v $PWD:/src -w /src -e LD_LIBRARY_PATH=/src/build/work/host/package -e EO_REPL=1 eo-core-base:desktop build/work/host/engine/eo-render build/work/host/package {doc} build/work/coedit/engine 1"
node editors-android/engine/tools/coedit/check.mjs --document-server http://localhost:8090 --secret <JWT secret> \
    --storage-url http://<host>:8095 document-templates/sample/sample.docx document-templates/sample/sample.pptx document-templates/sample/sample.xlsx
```

With `--nextcloud http://localhost:8081 --user admin --password admin <path in Nextcloud>` instead, it uses Nextcloud and the connector as the app does. `VERBOSE=1` logs the session; `TRACE_SCRIPT=<file>` runs a script in the engine before it joins.
