// Smoke test: spawn the MCP server over stdio, build a small .docx, and verify it.
// Run from the project root:  npm run test:mcp
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const storage = fs.mkdtempSync(path.join(os.tmpdir(), "studio-mcp-test-"));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(here, "..", "src", "index.js")],
  env: { ...process.env, STUDIO_STORAGE_DIR: storage },
});
const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(transport);

const tools = (await client.listTools()).tools.map((t) => t.name);
console.log("tools:", tools.join(", "));
if (!tools.includes("generate_image") || !tools.includes("image_status")) throw new Error("image tools missing");

const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text;
  if (r.isError) throw new Error(`${name} failed: ${text}`);
  return JSON.parse(text);
};

const imgStatus = await (async () => { const r = await client.callTool({ name: "image_status", arguments: {} }); return JSON.parse(r.content[0].text); })();
console.log("image providers:", JSON.stringify(imgStatus.providers));
const { docId, appliedFormat, styleKit } = await call("doc_start", { title: "Smoke Test Book", subtitle: "A tiny proof", author: "Studio", style_kit: "calm-forest", cover_label: "A Test Guide", font: "Times New Roman", body_size_pt: 12, chapter_heading_size_pt: 20, subheading_size_pt: 12, line_spacing: 1.15, justify: true, page_size: "A4" });
console.log("format:", JSON.stringify(appliedFormat), "kit:", styleKit);
if (styleKit !== "calm-forest") throw new Error("style kit not applied");
if (appliedFormat.pageSize !== "A4" || appliedFormat.justify !== true || appliedFormat.lineSpacing !== 1.15) throw new Error("format not applied");
await call("doc_add_section", { docId, kind: "front", title: "A Letter", blocks: [{ type: "paragraph", text: "Hello **reader**, this is *italic*." }] });
await call("doc_add_section", {
  docId, kind: "chapter", title: "The First Step", subtitle: "Where it begins", kicker: "Part One",
  blocks: [
    { type: "label", text: "The Story" },
    { type: "paragraph", text: "Story paragraph." },
    { type: "quote", text: "A quote.", attribution: "Someone Real" },
    { type: "heading", level: 2, text: "The Framework" },
    { type: "table", headers: ["Step", "Action"], rows: [["1", "Do this"], ["2", "Do that"]] },
    { type: "callout", title: "Micro-challenge", text: "Try it today." },
    { type: "checklist", items: ["One", "Two"] },
    { type: "numbered", items: ["First", "Second"] },
    { type: "bullets", items: ["A", "B"] },
    { type: "code", title: "Example 1.1: hello.py", text: "def greet(name):\n    return f\"Hello, {name}\"\n\nprint(greet(\"World\"))" },
  ],
});
const app = await call("doc_add_section", { docId, kind: "chapter", title: "The First Step", append: true, blocks: [{ type: "paragraph", text: "Appended text." }] });
if (!app.appended) throw new Error("append did not append");
const list = await call("doc_list", {});
if (!list.drafts.some((d) => d.docId === docId)) throw new Error("doc_list missing draft");
console.log("append + doc_list ok; estimatedPages:", app.estimatedPages);
// bad table should be rejected with a useful message
const bad = await client.callTool({ name: "doc_add_section", arguments: { docId, kind: "chapter", title: "Bad", blocks: [{ type: "table", headers: ["a", "b"], rows: [["only-one"]] }] } });
if (!bad.isError) throw new Error("expected validation error for ragged table");
console.log("validation ok:", bad.content[0].text.split("\n")[1]);

const built = await call("doc_build", { docId });
console.log("built:", JSON.stringify(built));
const out = path.join(storage, "outputs", built.file);
if (built.pdf?.file) {
  const pdfHead = fs.readFileSync(path.join(storage, "outputs", built.pdf.file)).subarray(0, 4).toString();
  if (pdfHead !== "%PDF") throw new Error("pdf is not a pdf");
  console.log("pdf ok:", built.pdf.file, "contents page numbers:", built.pdf.contentsHavePageNumbers);
} else {
  console.log("pdf skipped:", built.pdf?.error?.slice(0, 120));
}
const head = fs.readFileSync(out).subarray(0, 2).toString();
if (head !== "PK") throw new Error("docx is not a zip");
await call("save_file", { filename: "page.html", content: "<h1>hi</h1>" });
try { await call("save_file", { filename: "evil.exe", content: "x" }); throw new Error("should have failed"); } catch (e) { if (!/not allowed/.test(e.message)) throw e; }
console.log("OK ->", out);
await client.close();
