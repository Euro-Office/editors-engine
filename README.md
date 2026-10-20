# Engine

The C++ engine behind `libeditors`. It is not implemented yet; it depends on the Android build of core (milestone M0).

## Design

```
Kotlin UI (libg*) ── typed APIs (libdocs/libcells/libslides) ── libeditors (Kotlin + JNI) ── engine (C++) ── V8 + current sdkjs
                                                                                                  └── core: Graphics, TextMeasurer, Zip, NativeControl, DrawingFile embeds
```

- **JS:** one V8 isolate per open document on its own thread, created through core's doctrenderer (`core/DesktopEditor/doctrenderer/js_internal`). It loads the sdkjs native bundles and drives the editor through sdkjs's public `asc_*` API (`common/apiBase.js`: `native_callMethod`, `wrapEvent`).
- **Rendering:** sdkjs draws through `common/Native/native_graphics.js` into `CGraphicsEmbed`. The engine renders requested tiles into Android bitmaps.
- **Files:** documents are converted to and from Editor.bin with x2t (`core/X2tConverter`).
- **Startup:** a V8 snapshot of the sdkjs bundles (doctrenderer `GenerateEditorSnapshot`) replaces the closed `libbootstrap_jni`.

Planned JNI surface (exposed by `libeditors`): `open`, `callMethod(name, json)`, an event stream, `drawTile`, touch and key input, `save`, `close`.
