// The engine as a participant of a co-editing session, as the app runs it: eo-render (EO_REPL=1)
// runs the engine on the host, this carries its socket over socket.io, downloads what the server
// converted and the document's pictures, and runs the engine's timers.
//
// The engine runs through runEngine, a command line in which {doc} is the document's path, e.g. a
// docker command with core's build image (/src in the container is the current directory).
import { io } from "socket.io-client";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

const q = (value) => JSON.stringify(value);
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function download(url, path, headers = {}) {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`download ${url}: HTTP ${response.status}`);
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
}

// eo-render: one JavaScript line in, one "@@" result line out
function startEngine(runEngine, documentPath, log) {
    const command = runEngine.split(" ").filter(Boolean);
    const args = command.slice(1).map((arg) => arg.replace("{doc}", documentPath));
    const engine = spawn(command[0], args, { stdio: ["pipe", "pipe", "inherit"] });
    const lines = createInterface({ input: engine.stdout });
    const waiting = [];
    let ready;
    const started = new Promise((resolve, reject) => {
        ready = resolve;
        engine.on("exit", (code) => reject(new Error(`the engine ended (${code})`)));
    });
    lines.on("line", (line) => {
        if (!line.startsWith("@@")) return log("engine:", line);
        if (line === "@@ready") return ready();
        waiting.shift()?.(line.slice(2));
    });
    // Commands run one after the other
    let queue = Promise.resolve();
    const run = (script) => {
        const result = queue.then(() => new Promise((resolve) => {
            waiting.push(resolve);
            engine.stdin.write(script.replace(/\n/g, " ") + "\n");
        }));
        queue = result.catch(() => {});
        return result;
    };
    return { started, run, stop: () => engine.stdin.end() };
}

/**
 * Joins the session of config (an editor configuration with documentServerUrl) with the engine;
 * documentPath: the document as the integration has it (docbuilder needs a file of its type).
 */
export async function joinWithEngine({ config, documentPath, workDir, runEngine, log = () => {}, traceScript = null }) {
    mkdirSync(workDir, { recursive: true });
    const engine = startEngine(runEngine, documentPath, log);
    await engine.started;
    const run = engine.run;
    const type = config.documentType;
    const serverUrl = new URL(config.documentServerUrl);
    const imagesDir = (await run("eoEngine.getImagesDirectory()")).replace(/^\/src\//, "");
    let socket = null;
    let downloads = 0;
    const pictures = [];

    // What the engine's sdkjs sends
    async function pump() {
        const messages = JSON.parse(await run("eoEngine.coTakeOutbox()"));
        for (const message of messages) {
            if (message.type === "connect" && !socket) connect(message.options);
            else if (message.type === "emit") {
                if (message.data?.type !== "cursor") log("engine sends:", message.data?.type);
                socket?.emit(message.name, message.data);
            }
            else if (message.type === "disconnect") socket?.disconnect();
            else if (message.type === "fetch") fetchPicture(message.url, message.name);
            else if (message.type === "auth" && socket) socket.auth = { token: message.auth.token, session: message.auth.session };
        }
    }

    async function fetchPicture(url, name) {
        const path = join(imagesDir, name);
        if (existsSync(path)) return;
        try {
            await download(url, path);
        } catch (error) {
            return log("can't download picture", name, error.message);
        }
        pictures.push(name);
        await run(`eoEngine.coImageLoaded(${q(name)}); ''`);
    }

    function connect(options) {
        const path = serverUrl.pathname.replace(/\/$/, "") + `/doc/${config.document.key}/c`;
        const auth = options.auth || {};
        socket = io(serverUrl.origin, {
            path, transports: ["websocket"], query: options.query, reconnection: false,
            auth: { token: auth.token, session: auth.session }
        });
        const receive = (name, args) => run(`eoEngine.coReceive(${q(name)}, ${q(JSON.stringify(args))})`).then(pump);
        socket.on("connect", () => receive("connect", []));
        socket.on("disconnect", (reason) => receive("disconnect", [reason]));
        socket.on("connect_error", (error) => receive("connect_error", [{ message: error.message, data: error.data }]));
        socket.on("message", async (data) => {
            if (data.type !== "cursor") log("server:", data.type, JSON.stringify(data).slice(0, 200));
            // The converted document first, then the message that opens it
            const urls = data.type === "documentOpen" && data.data && data.data.data;
            // PDFs: the file itself
            const url = urls && typeof urls === "object" && (urls["Editor.bin"] || urls["origin.pdf"]);
            if (url) {
                const file = join(workDir, `Editor-${++downloads}.bin`);
                await download(url, file);
                // The engine's paths are relative to the current directory (in a container too)
                await run(`eoEngine.coSetFile(${q(url)}, ${q(relative(process.cwd(), file))})`);
            }
            await receive("message", [data]);
        });
    }

    if (traceScript) await run(traceScript);
    await run(`eoEngine.coOpen(${q(JSON.stringify(config))})`);
    await pump();
    // The engine's timers (layout, sending changes), as the app runs them
    const timer = setInterval(() => run("eoEngine.tick(20); eoEngine.coTick(); ''").then(pump), 100);

    const session = async () => JSON.parse(await run("JSON.stringify(eoEngine.coEditingState())"));
    const participant = {
        run,
        pictures,
        session,
        /** The session's document is loaded and the engine edits it. */
        async ready(timeoutMs = 30000) {
            for (const end = Date.now() + timeoutMs; Date.now() < end; await wait(500)) {
                const loaded = await run("String(Asc.editor.isDocumentLoadComplete && !window.eoCoState.loading)");
                const state = await session();
                if (loaded === "true" && state && state.state === 2) return;
            }
            throw new Error("the engine didn't join the session");
        },
        /** The text of the document (presentations: the first slide's; PDFs: the notes'). */
        async text() {
            if (type === "pdf") return run("Asc.editor.getPDFDoc().annots.map(function (annot) { return annot.GetContents() || ''; }).join(' / ')");
            if (type === "slide") return JSON.parse(await run("eoEngine.textBlocks(0)")).map((block) => block.text).join(" / ");
            if (type === "cell") return run("Asc.editor.wbModel.getWorksheet(0).getCell3(0, 0).getValue() + ' / ' + Asc.editor.wbModel.getWorksheet(0).getCell3(1, 0).getValue()");
            return JSON.parse(await run("JSON.stringify(Asc.editor.WordControl.m_oLogicDocument.GetText({ParaSeparator: ' / '}))"));
        },
        /** Types at the start of the document (presentations: of the first text box on the first slide; spreadsheets: into A1; PDFs: a note). */
        async type(text) {
            if (type === "pdf") {
                // Somewhere else each time: a note there gets the comment as a reply
                const x = 20 + Math.floor(Math.random() * 150), y = 40 + Math.floor(Math.random() * 200);
                return run(`eoEngine.setCommentUser("engine", "Engine"); eoEngine.mouse(0, 0, ${x}, ${y}, 1, false, false); ` +
                    `eoEngine.mouse(2, 0, ${x}, ${y}, 1, false, false); eoEngine.addComment(${q(text.trim())}); ''`);
            }
            if (type === "slide") {
                // The first text box that takes a cursor (others are on the slide's layout)
                for (const block of JSON.parse(await run("eoEngine.textBlocks(0)"))) {
                    const x = (block.left + block.right) / 2, y = (block.top + block.bottom) / 2;
                    const cursor = await run(`eoEngine.mouse(0, 0, ${x}, ${y}, 1, false, false); eoEngine.mouse(2, 0, ${x}, ${y}, 1, false, false); String(!!JSON.parse(eoEngine.getState()).cursor)`);
                    if (cursor === "true") break;
                }
                return run(`eoEngine.commitText(${q(text)}); ''`);
            }
            if (type === "cell") return run(`eoEngine.selectCells(0, 0, 0, 0); eoEngine.setCellText(${q(text.trim())}); ''`);
            return run(`eoEngine.keyDown(36, false, true); eoEngine.commitText(${q(text)}); ''`);
        },
        /** Inserts a picture as the app does: uploaded to the Document Server, then by the server's name. */
        async insertPicture(png) {
            const info = JSON.parse(await run("eoEngine.coUploadInfo()"));
            const response = await fetch(new URL(`upload/${encodeURIComponent(info.documentId)}`, serverUrl), {
                method: "POST", body: png, headers: { "Content-Type": "image/png", Authorization: `Bearer ${info.token}` }
            });
            if (!response.ok) throw new Error(`upload: HTTP ${response.status}`);
            const urls = await response.json();
            const key = Object.keys(urls).find((name) => name.startsWith("media/"));
            if (!key) throw new Error(`upload: ${JSON.stringify(urls)}`);
            const name = key.slice("media/".length);
            writeFileSync(join(imagesDir, name), png);
            await run(`eoEngine.coAddUrls(${q(JSON.stringify(urls))}); ''`);
            if (type === "slide") await run("eoEngine.gotoSlide(0); ''");
            await run(`eoEngine.insertImage(${q(name)}, 1, 1); ''`);
            return name;
        },
        /** Draws a page into a PNG (path relative to the current directory); returns its pixels in the red of others' locks. */
        async render(page, path) {
            return Number(await run(`!render ${page} ${path}`));
        },
        /**
         * The connection drops and doesn't come back, as when the app's socket gives up
         * reconnecting: sdkjs reconnects first, then only lets the document be viewed.
         */
        async dropConnection() {
            const dropped = new Promise((resolve) => socket.once("disconnect", resolve));
            socket.io.engine.close();
            await dropped;
        },
        async reconnectFailed() {
            await run(`eoEngine.coReceive("reconnect_failed", "[]"); ''`);
        },
        async leave() {
            clearInterval(timer);
            socket?.disconnect();
            await wait(500);
            engine.stop();
        }
    };
    return participant;
}

/** Runs script in the engine on the document at documentPath (relative to the current directory) and returns its result. */
export async function engineResult(runEngine, documentPath, script) {
    const engine = startEngine(runEngine, documentPath, () => {});
    await engine.started;
    const result = await engine.run(script);
    engine.stop();
    return result;
}

/** The file of an integration, copied for the engine to start with. */
export function localCopy(path, workDir) {
    mkdirSync(workDir, { recursive: true });
    const copy = join(workDir, "start-" + basename(path));
    copyFileSync(path, copy);
    return copy;
}

