// A minimal integration of the Document Server, in place of Nextcloud and its connector: it
// serves documents, signs editor configurations as the connector does (JWT, the server's secret),
// gives web editors a page and keeps what the server saves (its callback).
//
//   GET  /files/<name>            the document
//   GET  /config/<name>?user=<id>[&view=1] the editor configuration, as the connector's API returns it
//                                 (view: for someone who may only view the document)
//   GET  /editor/<name>?user=<id> a page with the web editor (the server's api.js)
//   POST /callback/<name>         the server's callback: a saved document goes to <dir>/saved/<name>
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

const DOCUMENT_TYPES = { docx: "word", pptx: "slide", xlsx: "cell" };

function base64url(value) {
    return Buffer.from(value).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function sign(payload, secret) {
    const data = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" })) + "." + base64url(JSON.stringify(payload));
    return data + "." + createHmac("sha256", secret).update(data).digest("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function payloadOf(token) {
    return JSON.parse(Buffer.from(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
}

/**
 * Starts the storage on port. documentServer: its URL for editors; publicUrl: this storage's URL
 * as the Document Server reaches it. Each document opened gets a new key (a new session).
 */
export function startStorage({ dir, port, secret, documentServer, publicUrl, log = () => {} }) {
    mkdirSync(join(dir, "saved"), { recursive: true });
    const keys = {};
    const saves = {};
    const waiting = [];

    function config(name, user, view = false) {
        const fileType = extname(name).slice(1);
        keys[name] = keys[name] || `${basename(name, extname(name)).replace(/[^A-Za-z0-9]/g, "")}${Date.now()}`;
        const settings = {
            documentType: DOCUMENT_TYPES[fileType],
            document: {
                fileType, key: keys[name], title: name, url: `${publicUrl}/files/${encodeURIComponent(name)}`,
                permissions: { edit: !view, comment: !view, download: true }
            },
            editorConfig: {
                callbackUrl: `${publicUrl}/callback/${encodeURIComponent(name)}`, mode: view ? "view" : "edit", lang: "en",
                user: { id: user, name: user },
                // The connector leaves it out for those who may only view
                ...(view ? {} : { coEditing: { mode: "fast", change: false } })
            }
        };
        return { ...settings, token: sign(settings, secret), documentServerUrl: documentServer.replace(/\/?$/, "/") };
    }

    function editorPage(name, user) {
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${name}</title>
<style>html, body, #editor { height: 100%; margin: 0; }</style>
<script src="${documentServer.replace(/\/$/, "")}/web-apps/apps/api/documents/api.js"></script></head>
<body><div id="editor"></div><script>
var config = ${JSON.stringify(config(name, user))};
config.width = "100%"; config.height = "100%";
new DocsAPI.DocEditor("editor", config);
</script></body></html>`;
    }

    async function callback(name, body) {
        const message = body.token ? payloadOf(body.token) : body;
        log("callback", name, "status", message.status);
        // Saves of earlier sessions (an earlier check of the same file) don't count
        if (message.key && message.key !== keys[name]) return;
        // 2: saved after everybody left; 6: forced save
        if ((message.status === 2 || message.status === 6) && message.url) {
            const response = await fetch(message.url);
            const path = join(dir, "saved", name);
            writeFileSync(path, Buffer.from(await response.arrayBuffer()));
            saves[name] = path;
            waiting.filter((w) => w.name === name).forEach((w) => w.resolve(path));
        }
    }

    const server = createServer(async (request, response) => {
        const url = new URL(request.url, "http://storage");
        const [, kind, encoded] = url.pathname.split("/");
        const name = decodeURIComponent(encoded || "");
        const user = url.searchParams.get("user") || "user";
        try {
            if (name.includes("/") || name.includes("..")) throw new Error("bad name");
            if (kind === "files") {
                const path = join(dir, name);
                statSync(path);
                response.writeHead(200, { "Content-Type": "application/octet-stream" });
                return response.end(readFileSync(path));
            }
            if (kind === "config") {
                response.writeHead(200, { "Content-Type": "application/json" });
                return response.end(JSON.stringify(config(name, user, url.searchParams.get("view") === "1")));
            }
            if (kind === "editor") {
                response.writeHead(200, { "Content-Type": "text/html" });
                return response.end(editorPage(name, user));
            }
            if (kind === "callback" && request.method === "POST") {
                let body = "";
                for await (const chunk of request) body += chunk;
                await callback(name, JSON.parse(body || "{}"));
                response.writeHead(200, { "Content-Type": "application/json" });
                return response.end('{"error":0}');
            }
            response.writeHead(404).end();
        } catch (error) {
            log("storage:", request.method, request.url, error.message);
            response.writeHead(500, { "Content-Type": "application/json" }).end('{"error":1}');
        }
    });
    server.listen(port);

    return {
        config,
        /** The saved document, once the server saved it (after everybody left). */
        saved(name, timeoutMs) {
            if (saves[name]) return Promise.resolve(saves[name]);
            return new Promise((resolve, reject) => {
                waiting.push({ name, resolve });
                setTimeout(() => reject(new Error(`${name} wasn't saved within ${timeoutMs / 1000} s`)), timeoutMs);
            });
        },
        close: () => server.close()
    };
}
