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
| `src/DrawingDocument.h/.cpp` | `eo::DrawingDocument`: PDF, XPS and DjVu through core's readers (PdfFile, XpsFile, DjVuFile), no sdkjs: pages, tiles, PDF passwords |
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
- `sdkjs/`: `word/sdk-all-min.js`, `word/sdk-all.js`, `common/Native/*.js`, `common/libfont/engine/fonts_native.js`, `vendor/xregexp-all-min.js`
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

## Spreadsheets (spike, step 5)

**Question:** can the spreadsheet editor draw a sheet and be edited without a browser, so that it fits the same engine and tile renderer as documents and presentations?

**Answer: yes.** `engine.js` has a spike adapter (`spreadsheetEngine`): page 0 is the used range of the active sheet. The app doesn't use it yet (`CellsActivity` is still the placeholder).

| Check | Result (desktop, `sample.xlsx`: 175 columns × 689 rows of formats) |
|---|---|
| Draw | `WorksheetView.drawForPrint` with a print page (`CPagePrint`) made of the cells under a tile, into the tile's `CNativeGraphics` (`CPdfPrinter.DocumentRenderer`). Values, number formats, fills, borders, pivot tables, charts and slicers render; grid lines optional. Whole sheet at 7633 × 8074 px: 0.6 s; 256 px tiles: 7.5 ms each on average. |
| Charts | Need `asc_nativeCalculateFile()` after opening (prepares the drawing objects). |
| Edit a cell | `WorksheetView._saveCellValueAfterEdit(range, [Fragment])`, the cell editor's commit, works without the DOM: a new fee recalculates the `SUMIF` total ($1,005,230 → $1,050,730), formulas work (`=F15*2`), undo restores both. |
| Format | `asc_setCellBold` etc. on the selection set with `WorksheetView.setSelection`. |
| Not usable | The web cell editor (`asc_enterText` → `CellEditor`) and the events controller depend on the DOM set up by the web editor. |

**Design for the cells editor:**
- The sheet is one large page; tiles draw the cells under them through the print path (as above). Several sheets are pages or a sheet switcher.
- Taps map to cells with the column and row positions (`_getColLeft`, `_getRowTop`); the app draws the selection and its handles itself.
- Editing a cell happens in a native text field (in place or as a formula bar) and is committed with `_saveCellValueAfterEdit`; the toolbar commands (`asc_setCellBold`, ...) act on the selection.
- Frozen panes and row/column headings are drawn by the app from the same positions.

