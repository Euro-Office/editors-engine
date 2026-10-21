// The web editor as the other participant of the co-editing check: logs into Nextcloud, opens the
// document in the Euro-Office editor and reports or edits it through sdkjs in the editor's frame.
//
//   node browser.mjs <nextcloud url> <user> <password> <path in Nextcloud> <scenario> [seconds]
import { chromium } from "playwright";

const [nextcloud, user, password, filePath, scenario = "ids", seconds = "60"] = process.argv.slice(2);
const log = (...args) => console.log(`[browser ${new Date().toISOString().slice(11, 23)}]`, ...args);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fileId() {
    const response = await fetch(`${nextcloud}/remote.php/dav/files/${user}/${encodeURI(filePath)}`, {
        method: "PROPFIND",
        headers: { Authorization: "Basic " + Buffer.from(`${user}:${password}`).toString("base64"), Depth: "0" },
        body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>'
    });
    return (await response.text()).match(/<oc:fileid>(\d+)<\/oc:fileid>/)[1];
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${nextcloud}/login`);
await page.fill("#user", user);
await page.fill("#password", password);
await page.click("button[type=submit]");
await page.waitForLoadState("networkidle");
await page.goto(`${nextcloud}/apps/eurooffice/${await fileId()}`);

// The editor's frame, once sdkjs has opened the document
let editor = null;
for (let i = 0; i < 90 && !editor; i++) {
    await wait(1000);
    for (const frame of page.frames()) {
        const ready = await frame.evaluate(() => !!(window.Asc && window.Asc.editor && window.Asc.editor.isDocumentLoadComplete)).catch(() => false);
        if (ready) editor = frame;
    }
}
if (!editor) {
    log("no editor");
    await page.screenshot({ path: "build/work/coedit/browser.png" });
    process.exit(1);
}
const run = (fn, arg) => editor.evaluate(fn, arg);
const info = () => run(() => {
    const document = Asc.editor.WordControl.m_oLogicDocument;
    return {
        ids: document.Content.slice(0, 3).map((paragraph) => paragraph.Get_Id()),
        text: document.GetText({ ParaSeparator: " / " }).slice(0, 120)
    };
});
log("opened:", JSON.stringify(await info()));

if (scenario === "type") {
    await run((text) => {
        const document = Asc.editor.WordControl.m_oLogicDocument;
        document.MoveCursorToStartPos();
        Asc.editor.asc_enterText(text);
    }, "Typed in the browser ");
}
const end = Date.now() + Number(seconds) * 1000;
while (Date.now() < end) {
    await wait(5000);
    log(JSON.stringify(await info()));
}
await browser.close();
