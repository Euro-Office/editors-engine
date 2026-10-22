// The web editor as the other participant of a co-editing check (Playwright): it opens the
// document in the Document Server's editor and reads or edits it through sdkjs in the editor's
// frame.
import { chromium } from "playwright";
import { wait } from "./engine.mjs";

// A picture (1 x 1 pixels), which the server stores with the document
export const PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

/**
 * Opens url (a page with the editor) in a browser; with nextcloud ({url, user, password}), logs
 * in there first.
 */
export async function joinWithBrowser({ url, nextcloud = null, log = () => {} }) {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on("pageerror", (error) => log("web page error:", error.message));
    if (nextcloud) {
        await page.goto(`${nextcloud.url}/login`);
        await page.fill("#user", nextcloud.user);
        await page.fill("#password", nextcloud.password);
        await page.click("button[type=submit]");
        await page.waitForLoadState("networkidle");
    }
    await page.goto(url);

    // The editor's frame, once sdkjs has opened the document
    let editor = null;
    for (let i = 0; i < 120 && !editor; i++) {
        await wait(1000);
        for (const frame of page.frames()) {
            const ready = await frame.evaluate(() => !!(window.Asc && window.Asc.editor && window.Asc.editor.isDocumentLoadComplete)).catch(() => false);
            if (ready) editor = frame;
        }
    }
    if (!editor) {
        await browser.close();
        throw new Error("the web editor didn't open the document");
    }
    const run = (fn, arg) => editor.evaluate(fn, arg);
    const type = await run(() => Asc.editor.isPdfEditor && Asc.editor.isPdfEditor() ? "pdf"
        : Asc.editor.editorId === AscCommon.c_oEditorId.Presentation ? "slide"
        : Asc.editor.editorId === AscCommon.c_oEditorId.Spreadsheet ? "cell" : "word");

    const participant = {
        run,
        /** The text of the document (presentations: the first slide's text boxes; PDFs: the notes'). */
        text: () => run((type) => {
            if (type === "pdf") return Asc.editor.getPDFDoc().annots.map((annot) => annot.GetContents() || "").join(" / ");
            if (type === "slide") {
                return Asc.editor.WordControl.m_oLogicDocument.Slides[0].cSld.spTree
                    .filter((shape) => shape.getDocContent && shape.getDocContent())
                    .map((shape) => shape.getDocContent().GetText({ ParaSeparator: " " }).trim()).join(" / ");
            }
            if (type === "cell") {
                const sheet = Asc.editor.wbModel.getWorksheet(0);
                return sheet.getCell3(0, 0).getValue() + " / " + sheet.getCell3(1, 0).getValue();
            }
            return Asc.editor.WordControl.m_oLogicDocument.GetText({ ParaSeparator: " / " });
        }, type),
        /** Pictures in the document (presentations: on the first slide). */
        pictures: () => run((type) => {
            if (type === "slide") {
                return Asc.editor.WordControl.m_oLogicDocument.Slides[0].cSld.spTree
                    .filter((shape) => shape.getObjectType() === AscDFH.historyitem_type_ImageShape).length;
            }
            if (type === "cell") return Asc.editor.wbModel.getWorksheet(0).Drawings.length;
            return Asc.editor.WordControl.m_oLogicDocument.GetAllDrawingObjects().length;
        }, type),
        /** Types at the start of the document (presentations: of the first text box; spreadsheets: into A2). */
        async type(text) {
            // Not while sdkjs applies others' changes: it takes no input then
            for (let i = 0; i < 60; i++) {
                const busy = await run(() => Asc.editor.isLongAction() || AscCommon.CollaborativeEditing.Get_GlobalLock());
                if (!busy) break;
                await wait(500);
            }
            await typeText(text);
            if (!(await this.text()).includes(text.trim())) throw new Error("the web editor didn't take the text");
        },
        /** Switches to strict co-editing and types as type() does: the paragraph or text box stays locked until endStrict. */
        typeStrict: (text) => typeText(text, true),
        /** Saves the changes of strict co-editing and switches back to fast co-editing. */
        endStrict: () => run(() => {
            Asc.editor.asc_Save();
            Asc.editor.asc_SetFastCollaborative(true);
        }),
        /** The comments: [{id, text, replies: [text]}]. */
        comments: () => run((type) => {
            const json = (id, data) => ({ id: String(id), text: data.asc_getText(),
                replies: Array.from({ length: data.asc_getRepliesCount() }, (_, i) => data.asc_getReply(i).asc_getText()) });
            if (type === "pdf") {
                return Asc.editor.getPDFDoc().annots.map((annot) => ({ annot, data: annot.GetAscCommentData() }))
                    .filter((item) => item.data).map((item) => json(item.annot.GetId(), item.data));
            }
            if (type === "cell") {
                const model = Asc.editor.wbModel;
                return Array.from({ length: model.getWorksheetCount() }, (_, i) => model.getWorksheet(i).aComments).flat()
                    .map((comment) => json(comment.asc_getId(), comment));
            }
            if (type === "slide") {
                return Asc.editor.WordControl.m_oLogicDocument.GetAllComments()
                    .map((item) => json(item.comment.Get_Id(), new Asc.asc_CCommentDataSlide(item.comment.Data)));
            }
            const all = Asc.editor.WordControl.m_oLogicDocument.Comments.GetAllComments();
            return Object.keys(all).map((id) => json(id, new Asc.asc_CCommentDataWord(all[id].GetData())));
        }, type),
        /** Comments the start of the document (presentations: the first slide; spreadsheets: cell U41). */
        addComment: (text) => run(({ type, text }) => {
            const Data = type === "cell" ? Asc.asc_CCommentData : type === "slide" ? Asc.asc_CCommentDataSlide : Asc.asc_CCommentDataWord;
            const data = new Data();
            data.asc_putText(text);
            data.asc_putUserName("Web");
            data.asc_putTime(String(Date.now()));
            // On a cell or the text, not on the workbook or document (PDFs: a note on the page)
            if (type !== "slide" && type !== "pdf") data.asc_putDocumentFlag(false);
            if (type === "pdf") data.asc_putOnlyOfficeTime(String(Date.now()));
            if (type === "cell") Asc.editor.wb.getWorksheet().setSelection(new Asc.Range(20, 40, 20, 40));
            if (type === "word") Asc.editor.WordControl.m_oLogicDocument.MoveCursorToStartPos();
            Asc.editor.asc_addComment(data);
        }, { type, text }),
        /** Spreadsheets: selects the cells from (c1, r1) to (c2, r2). */
        selectCells: (c1, r1, c2, r2) => run(([c1, r1, c2, r2]) => Asc.editor.wb.getWorksheet().setSelection(new Asc.Range(c1, r1, c2, r2)), [c1, r1, c2, r2]),
        /** Spreadsheets: whether others' selections include the cells from (c1, r1) to (c2, r2). */
        seesSelection: (c1, r1, c2, r2) => run(([c1, r1, c2, r2]) => Object.values(Asc.editor.collaborativeEditing.m_aForeignCursorsData)
            .some((data) => data && data.ranges && data.ranges.some((range) => range.c1 === c1 && range.r1 === r1 && range.c2 === c2 && range.r2 === r2)), [c1, r1, c2, r2]),
        insertPicture: () => run((url) => Asc.editor.AddImageUrl([url]), "data:image/png;base64," + PIXEL_PNG.toString("base64")),
        leave: () => browser.close()
    };
    return participant;

    function typeText(text, strict = false) {
        return run(({ type, text, strict }) => {
            if (strict) Asc.editor.asc_SetFastCollaborative(false);
            if (type === "slide") {
                const presentation = Asc.editor.WordControl.m_oLogicDocument;
                const shape = presentation.Slides[0].cSld.spTree.find((item) => item.getDocContent && item.getDocContent());
                const controller = presentation.GetCurrentController();
                controller.resetSelection();
                controller.selectObject(shape, 0);
                controller.selection.textSelection = shape;
                shape.getDocContent().MoveCursorToStartPos();
            } else if (type === "pdf") {
                // A note
                const data = new Asc.asc_CCommentDataWord();
                data.asc_putText(text.trim());
                data.asc_putUserName("Web");
                data.asc_putOnlyOfficeTime(String(Date.now()));
                Asc.editor.asc_addComment(data);
                return;
            } else if (type === "cell") {
                // As the cell editor saves a cell
                const ws = Asc.editor.wb.getWorksheet();
                ws.setSelection(new Asc.Range(0, 1, 0, 1));
                const range = ws.model.getRange3(1, 0, 1, 0);
                const fragment = new AscCommonExcel.Fragment();
                fragment.setFragmentText(text.trim());
                fragment.format = range.getFont().clone();
                ws._saveCellValueAfterEdit(range, [fragment], undefined, false, false);
                return;
            } else {
                Asc.editor.WordControl.m_oLogicDocument.MoveCursorToStartPos();
            }
            Asc.editor.asc_enterText(text);
        }, { type, text, strict });
    }
}
