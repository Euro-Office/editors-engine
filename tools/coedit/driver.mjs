// Co-editing check: the engine on the host (eo-render with EO_REPL=1) joins the co-editing
// session of a document in Nextcloud, as the app will: it gets the editor configuration from the
// Euro-Office connector, carries the engine's socket over socket.io, downloads what the server
// converted and runs the engine's timers. Then it runs a scenario (see below).
//
//   node driver.mjs <nextcloud url> <user> <password> <path in Nextcloud> <scenario>
//
// The engine runs through RUN_ENGINE, a command line in which {doc} is the document's path,
// e.g. a docker command with core's build image.
import { io } from "socket.io-client";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [nextcloud, user, password, filePath, scenario = "type"] = process.argv.slice(2);
const workDir = process.env.WORK_DIR || "build/work/coedit";
const auth = "Basic " + Buffer.from(`${user}:${password}`).toString("base64");
const log = (...args) => console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...args);

// --- Nextcloud: the file's id and the editor configuration -----------------------------------

async function fileId() {
    const response = await fetch(`${nextcloud}/remote.php/dav/files/${user}/${encodeURI(filePath)}`, {
        method: "PROPFIND",
        headers: { Authorization: auth, Depth: "0", "Content-Type": "application/xml" },
        body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>'
    });
    const id = (await response.text()).match(/<oc:fileid>(\d+)<\/oc:fileid>/)?.[1];
    if (!id) throw new Error(`no file id for ${filePath}: HTTP ${response.status}`);
    return id;
}

async function editorConfig(id) {
    const response = await fetch(`${nextcloud}/ocs/v2.php/apps/eurooffice/api/v1/config/${id}?format=json`, {
        headers: { Authorization: auth, "OCS-APIRequest": "true", Accept: "application/json" }
    });
    const json = await response.json();
    const config = json.ocs ? json.ocs.data : json;
    if (!config.document) throw new Error(`no editor configuration: ${JSON.stringify(json).slice(0, 300)}`);
    return config;
}

async function download(url, path, headers = {}) {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`download ${url}: HTTP ${response.status}`);
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
}

// --- The engine: one JavaScript line in, one "@@" result line out ----------------------------

function startEngine(documentPath) {
    const command = (process.env.RUN_ENGINE || "").split(" ").filter(Boolean);
    const args = command.slice(1).map((arg) => arg.replace("{doc}", documentPath));
    const engine = spawn(command[0], args, { stdio: ["pipe", "pipe", "inherit"] });
    const lines = createInterface({ input: engine.stdout });
    const waiting = [];
    let ready;
    const started = new Promise((resolve) => (ready = resolve));
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

// --- The session -------------------------------------------------------------------------------

const q = (value) => JSON.stringify(value);

async function main() {
    mkdirSync(workDir, { recursive: true });
    const id = await fileId();
    const config = await editorConfig(id);
    log("config:", config.documentType, config.document.key, "server", config.documentServerUrl);

    // The engine starts with the document as it is (docbuilder needs a file of its type); the
    // session then loads it as the server converted it
    const localPath = join(workDir, "start." + config.document.fileType);
    await download(`${nextcloud}/remote.php/dav/files/${user}/${encodeURI(filePath)}`, localPath, { Authorization: auth });
    const engine = startEngine(localPath);
    await engine.started;
    log("engine ready");

    const serverUrl = new URL(config.documentServerUrl);
    let socket = null;
    let downloads = 0;

    // What the engine's sdkjs sends
    async function pump() {
        const messages = JSON.parse(await engine.run("eoEngine.coTakeOutbox()"));
        for (const message of messages) {
            if (message.type === "connect" && !socket) connect(message.options);
            else if (message.type === "emit") {
                log("engine sends:", message.data && message.data.type);
                socket?.emit(message.name, message.data);
            }
            else if (message.type === "disconnect") socket?.disconnect();
        }
    }

    function connect(options) {
        const path = serverUrl.pathname.replace(/\/$/, "") + `/doc/${config.document.key}/c`;
        log("connect", serverUrl.origin + path);
        socket = io(serverUrl.origin, {
            path,
            transports: ["websocket"],
            auth: options.auth,
            query: options.query,
            reconnection: false
        });
        const receive = (name, args) => engine.run(`eoEngine.coReceive(${q(name)}, ${q(JSON.stringify(args))})`).then(pump);
        socket.on("connect", () => { log("connected"); receive("connect", []); });
        socket.on("disconnect", (reason) => { log("disconnected:", reason); receive("disconnect", [reason]); });
        socket.on("connect_error", (error) => { log("connect error:", error.message, error.data); receive("connect_error", [{ message: error.message, data: error.data }]); });
        socket.on("message", async (data) => {
            log("server:", data.type, JSON.stringify(data).slice(0, 160));
            // The converted document first, then the message that opens it
            const urls = data.type === "documentOpen" && data.data && data.data.data;
            if (urls && typeof urls === "object" && urls["Editor.bin"]) {
                const path = join(workDir, `Editor-${++downloads}.bin`);
                await download(urls["Editor.bin"], path);
                await engine.run(`eoEngine.coSetFile(${q(urls["Editor.bin"])}, ${q(path)})`);
                log("downloaded Editor.bin");
            }
            await receive("message", [data]);
        });
    }

    if (process.env.TRACE_ACTIONS) {
        await engine.run(`(function () { var a = Asc.editor; window.actionLog = [];
            var start = a.sync_StartAction, end = a.sync_EndAction;
            a.sync_StartAction = function (type, id) { window.actionLog.push("start " + type + "/" + id); return start.apply(this, arguments); };
            a.sync_EndAction = function (type, id) { window.actionLog.push("end " + type + "/" + id); return end.apply(this, arguments); };
            var send = a.sendEvent; a.sendEvent = function (name) { if (!/Focus|Update|Can|Show|Hide|Mouse|Page|Comment|Count/.test(name)) window.actionLog.push("event " + name); return send.apply(this, arguments); };
            var co = a.CoAuthoringApi._CoAuthoringApi; var send0 = co._send; co._send = function (data) { window.actionLog.push("_send " + (data && data.type)); return send0.apply(this, arguments); };
            var save0 = a.asc_Save; a.asc_Save = function () { window.actionLog.push("asc_Save canSave=" + a.canSave); return save0.apply(this, arguments); };
            ["onEndLoadFile", "openDocument", "asyncFontsDocumentEndLoaded", "asyncImagesDocumentEndLoaded", "onDocumentContentReady", "asyncServerIdEndLoaded", "_openDocumentEndCallback"].forEach(function (name) {
                var f = a[name]; if (f) a[name] = function () { window.actionLog.push("call " + name); try { return f.apply(this, arguments); } catch (e) { window.actionLog.push("throw " + name + ": " + e); throw e; } };
            });
            return ""; })()`);
    }
    if (process.env.TRACE_IDS) {
        await engine.run(`(function () { var a = Asc.editor; var o = a.openDocument;
            a.openDocument = function () { window.idAtOpen = AscCommon.g_oIdCounter.m_nIdCounterLoad;
                if (${q(process.env.TRACE_IDS)} !== "1") AscCommon.g_oIdCounter.m_nIdCounterLoad = Number(${q(process.env.TRACE_IDS)});
                return o.apply(this, arguments); }; return ""; })()`);
    }
    await engine.run(`eoEngine.coOpen(${q(JSON.stringify(config))})`);
    await pump();

    // The engine's timers (layout, sending changes)
    const timer = setInterval(() => engine.run("eoEngine.tick(20); eoEngine.coTick(); ''").then(pump), 100);

    const state = async () => JSON.parse(await engine.run("eoEngine.coState()"));
    // Results are one line: text as JSON
    const text = () => engine.run("JSON.stringify(Asc.editor.WordControl.m_oLogicDocument.GetText({ParaSeparator: ' / '}).slice(0, 160))");
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    await wait(5000);
    log("state after opening:", await state(), "text:", await text());
    if (process.env.TRACE_IDS) log("counter at open:", await engine.run("String(window.idAtOpen)"));
    log("ids:", await engine.run("JSON.stringify(Asc.editor.WordControl.m_oLogicDocument.Content.slice(0, 3).map(function (p) { return p.Get_Id(); }))"));
    if (scenario === "type") {
        if (process.env.TRACE_ACTIONS) await engine.run(`window.actionLog.push("before typing canSave=" + Asc.editor.canSave + " points=" + AscCommon.History.Points.length); ''`);
        await engine.run(`eoEngine.keyDown(36, false, true); eoEngine.commitText(${q("Typed by the engine ")}); ''`);
        if (process.env.TRACE_ACTIONS) await engine.run(`window.actionLog.push("after typing canSave=" + Asc.editor.canSave + " points=" + AscCommon.History.Points.length); ''`);
        await wait(3000);
        log("state after typing:", await state(), "text:", await text());
        if (process.env.TRACE_ACTIONS) log("actions:", await engine.run("JSON.stringify(window.actionLog)"));
        log("sdkjs:", await engine.run(`(function () { var a = Asc.editor, c = AscCommon.CollaborativeEditing, h = AscCommon.History;
            return JSON.stringify({ canSave: a.canSave, viewMode: a.isViewMode, gap: a.autoSaveGap, unlock: a.canUnlockDocument,
                loaded: a.isDocumentLoadComplete, online: a.CoAuthoringApi.get_onlineWork(), fast: c.Is_Fast(), single: c.Is_SingleUser(),
                changes: h.Have_Changes ? h.Have_Changes() : null, localChanges: c.m_aAllChanges ? c.m_aAllChanges.length : null,
                ownChanges: c.m_aOwnChangesIndexes ? c.m_aOwnChangesIndexes.length : null, coauthoring: a.isCoAuthoringEnable,
                startCo: a.canStartCoAuthoring, collab: c.m_bGlobalLock, users: c.m_nUseType,
                longAction: a.isLongAction(), longActions: a.IsLongActionCurrent, saveCheck: a._saveCheck(),
                points: h.Points.length, index: h.Index, historyOn: h.Is_On(), turnOff: h.TurnOffHistory, globalLock: c.Get_GlobalLock && c.Get_GlobalLock(),
                saveIndex: h.SavedIndex, canEdit: a.canEdit && a.canEdit(), isSaving: a.CoAuthoringApi._CoAuthoringApi._isSaving }); })()`));
    }
    if (scenario === "watch") {
        for (let i = 0; i < 12; i++) {
            await wait(5000);
            log("text:", await text(), await engine.run(`(function () { var a = Asc.editor, c = AscCommon.CollaborativeEditing;
                return JSON.stringify({ other: c.Have_OtherChanges(), changes: c.m_aChanges.length, single: c.Is_SingleUser(), fast: c.Is_Fast(),
                    long: a.isLongAction(), canSave: a.canSave, globalLock: c.Get_GlobalLock(), own: AscCommon.History.Have_Changes(true) }); })()`));
        }
    }
    clearInterval(timer);
    socket?.disconnect();
    await wait(500);
    engine.stop();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
