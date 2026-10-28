## What this repo is

editors-engine is the engine of the Euro-Office mobile editors: C++ that runs current sdkjs in core's doctrenderer (V8) and draws pages with core's graphics engine, plus the JavaScript that drives sdkjs (`src/engine.js`, `src/pdf.js`). The Android app ([editors-android](https://github.com/Euro-Office/editors-android)) and the iOS app ([editors-ios](https://github.com/Euro-Office/editors-ios)) share it. It is a submodule of [MobileEditors](https://github.com/Euro-Office/MobileEditors), which pins core and sdkjs.

## Layout

| Path | Purpose |
|---|---|
| `src/` | `eo::Document`, `eo::DrawingDocument`, `eo::Speller` and the sdkjs side (`engine.js`, `pdf.js`) |
| `tests/` | Regression tests on document-templates' samples (`run.sh`, with `eo-render`) |
| `tools/render.cpp` | `eo-render`: desktop check tool and REPL (`EO_REPL=1`) |
| `tools/coedit/` | Co-editing check against a Document Server (Node, Playwright) |
| `third_party/hunspell` | Hunspell (submodule) |

## Rules

- **No platform code here.** Platform bindings (JNI, Objective-C++/Swift) live in the app repositories and add their sources to the `eoengine` CMake target. Platform differences inside the engine stay behind `#ifdef` (logging, x2t in-process).
- The commands of `engine.js`/`pdf.js` (`eoEngine.*`) and the JSON state are the apps' API: change them together with the apps' bindings (editors-android's `EditorDocument`, editors-ios).
- Don't change core or sdkjs from here; they are shared with DocumentServer and DesktopEditors.

## Build and test

`.docker/editors-engine.bake.Dockerfile` builds the engine for the host with `eo-render` (`engine-host`) and runs the tests (`engine-tests`). From the MobileEditors checkout (see its `build/README.md`):

```sh
cd build && docker buildx bake --allow=fs.read=.. engine-tests     # result in build/out/engine-tests
docker buildx bake --allow=fs.read=.. engine-host --load            # for running tests or eo-render from the checkout:
cd .. && docker run --rm -v "$PWD":/src -w /src ghcr.io/euro-office/editors-engine-host \
    editors-engine/tests/run.sh /engine/eo-render /package/bin
```

## Commits

- Commit messages must follow the Conventional Commits v1.0.0 specification — e.g. fix(engine): keep the cursor after saving.
- Every commit containing AI-assisted content must include an `Assisted-by: AGENT_NAME:MODEL_VERSION` trailer.
- Agents must not push, open pull requests or add `Signed-off-by`. See the [AI Contribution Policy](https://github.com/Euro-Office/.github/blob/main/AI_POLICY.md).
