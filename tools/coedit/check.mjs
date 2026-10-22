// Co-editing check: the engine (as the app runs it) and a web editor edit a document together
// through a Document Server; then the saved document must have both's edits.
//
// With the test storage (storage.mjs) in place of an integration:
//   node check.mjs --document-server http://localhost:8090 --secret <JWT secret> \
//       --storage-url http://<host as the Document Server reaches it>:8095 [--port 8095] <file> ...
// With Nextcloud and the Euro-Office connector (files already in Nextcloud):
//   node check.mjs --nextcloud http://localhost:8081 --user admin --password admin <path in Nextcloud> ...
//
// RUN_ENGINE: the command line that runs eo-render with EO_REPL=1 (see engine.mjs). Results:
// "ok <file>" or "FAIL <file>: <reason>" lines; the exit code is the number of failures.
import { mkdirSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { joinWithEngine, wait } from "./engine.mjs";
import { joinWithBrowser, PIXEL_PNG } from "./web.mjs";
import { startStorage } from "./storage.mjs";

const args = process.argv.slice(2);
const option = (name, fallback = null) => {
    const index = args.indexOf(`--${name}`);
    if (index < 0) return fallback;
    const [value] = args.splice(index, 2).slice(1);
    return value;
};
const documentServer = option("document-server");
const secret = option("secret");
const storageUrl = option("storage-url");
const port = Number(option("port", "8095"));
const nextcloudUrl = option("nextcloud");
const nextcloud = nextcloudUrl && { url: nextcloudUrl, user: option("user", "admin"), password: option("password", "admin") };
const workDir = resolve(option("work-dir", "build/work/coedit"));
const files = args;
const verbose = !!process.env.VERBOSE;
const runEngine = process.env.RUN_ENGINE;
const log = (...items) => console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...items);
const debug = (...items) => verbose && log(...items);

if (!runEngine || files.length === 0 || !(nextcloud || (documentServer && secret && storageUrl))) {
    console.error("usage: see check.mjs");
    process.exit(2);
}

async function until(what, check, timeoutMs = 30000) {
    let last;
    for (const end = Date.now() + timeoutMs; Date.now() < end; await wait(500)) {
        last = await check();
        if (last) return last;
    }
    throw new Error(`timed out: ${what}`);
}

// --- Where the documents come from --------------------------------------------------------------

function nextcloudSource() {
    const auth = "Basic " + Buffer.from(`${nextcloud.user}:${nextcloud.password}`).toString("base64");
    const dav = (path) => `${nextcloud.url}/remote.php/dav/files/${nextcloud.user}/${encodeURI(path)}`;
    async function fileId(path) {
        const response = await fetch(dav(path), {
            method: "PROPFIND",
            headers: { Authorization: auth, Depth: "0", "Content-Type": "application/xml" },
            body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>'
        });
        const id = (await response.text()).match(/<oc:fileid>(\d+)<\/oc:fileid>/)?.[1];
        if (!id) throw new Error(`no file id for ${path}: HTTP ${response.status}`);
        return id;
    }
    async function fetchTo(path, target) {
        const response = await fetch(dav(path), { headers: { Authorization: auth } });
        if (!response.ok) throw new Error(`download ${path}: HTTP ${response.status}`);
        writeFileSync(target, Buffer.from(await response.arrayBuffer()));
        return target;
    }
    return {
        async open(path) {
            const id = await fileId(path);
            // The connector's API, as the app asks it
            const response = await fetch(`${nextcloud.url}/ocs/v2.php/apps/eurooffice/api/v1/config/${id}?format=json`, {
                headers: { Authorization: auth, "OCS-APIRequest": "true", Accept: "application/json" }
            });
            const json = await response.json();
            const config = json.ocs ? json.ocs.data : json;
            if (!config.document) throw new Error(`no editor configuration: ${JSON.stringify(json).slice(0, 300)}`);
            const local = await fetchTo(path, join(workDir, "start-" + basename(path)));
            return { config, local, webUrl: `${nextcloud.url}/apps/eurooffice/${id}` };
        },
        // Nextcloud keeps the version the server saved
        async saved(path, before) {
            return until("the saved document", async () => {
                const target = await fetchTo(path, join(workDir, "saved-" + basename(path)));
                return readFileSync(target).equals(before) ? null : target;
            }, 90000);
        }
    };
}

function storageSource() {
    const dir = join(workDir, "storage");
    mkdirSync(dir, { recursive: true });
    const storage = startStorage({ dir, port, secret, documentServer, publicUrl: storageUrl, log: debug });
    return {
        async open(path) {
            const name = basename(path);
            copyFileSync(path, join(dir, name));
            const local = join(workDir, "start-" + name);
            copyFileSync(path, local);
            return { config: storage.config(name, "engine"), local, webUrl: `http://localhost:${port}/editor/${encodeURIComponent(name)}?user=web` };
        },
        saved: (path) => storage.saved(basename(path), 90000),
        close: () => storage.close()
    };
}

// The text of a saved document: its XML without the markup (text is split into runs)
function savedText(path) {
    const parts = { docx: ["word/document.xml"], pptx: ["ppt/slides/slide1.xml"], xlsx: ["xl/sharedStrings.xml", "xl/worksheets/sheet1.xml"] };
    const kind = path.split(".").pop();
    return parts[kind].map((part) => {
        try {
            return execFileSync("unzip", ["-p", path, part], { maxBuffer: 64 << 20 }).toString().replace(/<[^>]+>/g, "");
        } catch {
            return "";
        }
    }).join(" ");
}

// --- The check ----------------------------------------------------------------------------------

async function check(source, path) {
    const kind = path.split(".").pop();
    const engineText = `Engine ${kind} ${Date.now() % 100000}`;
    const webText = `Web ${kind} ${Date.now() % 100000}`;
    const { config, local, webUrl } = await source.open(path);
    const before = readFileSync(local);
    debug("session", config.document.key);

    const traceScript = process.env.TRACE_SCRIPT ? readFileSync(process.env.TRACE_SCRIPT, "utf8") : null;
    const engine = await joinWithEngine({ config, documentPath: relative(process.cwd(), local), workDir: join(workDir, "engine"), runEngine, log: debug, traceScript });
    let web = null;
    try {
        await engine.ready();
        debug("engine joined:", await engine.text());
        if (traceScript) debug("trace:", await engine.run("JSON.stringify(window.traceLog || [])"));
        web = await joinWithBrowser({ url: webUrl, nextcloud: source.nextcloud ? nextcloud : null, log: debug });
        debug("web joined:", await web.text());

        await until("the engine sees the web editor", async () => (await engine.session()).participants.filter((p) => !p.me).length > 0);

        // Typing in the engine reaches the web editor, and the other way round
        await engine.type(engineText + " ");
        debug("engine typed:", (await engine.text()).slice(0, 80));
        await until("the web editor gets the engine's text", async () => (await web.text()).includes(engineText));
        await web.type(webText + " ");
        await until("the engine gets the web editor's text", async () => (await engine.text()).includes(webText));
        if (kind === "docx") {
            await until("the engine shows the web editor's cursor", async () => (await engine.session()).cursors.length > 0);
        }

        // Pictures: the web editor's are downloaded for the engine; the engine's are uploaded
        if (kind !== "xlsx") {
            await web.insertPicture();
            await until("the engine downloads the web editor's picture", async () => engine.pictures.length > 0);
            const pictures = await web.pictures();
            await engine.insertPicture(PIXEL_PNG);
            await until("the web editor gets the engine's picture", async () => (await web.pictures()) > pictures);
        }
    } finally {
        await web?.leave();
        await engine.leave();
    }

    // The Document Server saves into the integration once everybody left
    const saved = await source.saved(path, before);
    const text = savedText(saved);
    for (const expected of [engineText, webText]) {
        if (!text.includes(expected)) throw new Error(`the saved document doesn't have "${expected}"`);
    }
}

const source = nextcloud ? { ...nextcloudSource(), nextcloud: true } : storageSource();
let failures = 0;
for (const file of files) {
    try {
        await check(source, file);
        console.log(`ok   ${file}`);
    } catch (error) {
        failures++;
        console.log(`FAIL ${file}: ${error.message}`);
        debug(error.stack);
    }
}
source.close?.();
process.exit(failures);
