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
| `src/jni/DocumentJni.cpp` | JNI for `lib.editors.base.engine.NativeEngine` (Android only); draws into `Bitmap`s |
| `tools/render.cpp` | Desktop check: renders page 1 whole and from tiles, compares both and saves PNGs |

## How it works

- **Opening.** `CDocBuilder` opens the file: x2t converts it to sdkjs' format, then doctrenderer loads sdkjs with the document. On Android, x2t runs in-process through `CDocBuilder::SetX2tConverter`, because apps can't start the x2t executable.
- **Builder mode.** docbuilder opens documents for scripting: no layout, no interface events, no undo. `engine.js` switches those back on and lays the document out.
- **Drawing.** sdkjs draws a page into `CNativeGraphics`, which is core's `CGraphicsEmbed`. The engine attaches its own `CGraphicsAppImage` to the graphics object, so sdkjs draws straight into the caller's buffer (an Android bitmap). The app image also provides fonts loaded once and an image cache shared by all tiles of a document.
- **Saving.** `CDocBuilder::SaveFile` takes the edited document from sdkjs and x2t converts it to the target format (docx, odt, rtf, txt, pdf, ...; not doc). The app saves into a temporary file first and then replaces the document. Editing continues afterwards: after a PDF export, docbuilder turns builder mode's silent mode back on and lays the document out again, so `engine.js` restores the interface events and the cursor.
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

| | Desktop (x86_64) | Emulator (x86_64) |
|---|---|---|
| Start (unpack, font index, V8) | – | 2.2 s (first start) |
| `sample.docx`: open and layout | 0.7 s | 3.2 s |
| `sample.docx`: page 1 (images, shapes) | 234 ms | 511 ms (1017 px wide) |
| 8-page text document: page | 25 ms | 30–170 ms |

sdkjs draws a whole page per call, so the viewer renders whole pages at screen width and, when zoomed in, the visible area only (as sdkjs' web editor does), rather than small tiles.
