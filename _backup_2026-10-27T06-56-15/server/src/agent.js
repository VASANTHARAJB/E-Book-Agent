import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { db } from "./db.js";
import { emit } from "./events.js";
import { connectMcp } from "./mcpClient.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = fs.readFileSync(path.join(here, "prompts", "studio.md"), "utf8");

export const projectDir = (userId, conversationId) => path.join(config.dataDir, "users", userId, conversationId);

const insertMsg = db.prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)");
const persist = (conversationId, role, content) => insertMsg.run(conversationId, role, JSON.stringify(content));

function loadHistory(conversationId) {
  return db
    .prepare("SELECT role, content FROM messages WHERE conversation_id=? ORDER BY id")
    .all(conversationId)
    .map((m) => ({ role: m.role, content: JSON.parse(m.content) }));
}

const upsertFile = db.prepare(`
  INSERT INTO files (id, conversation_id, user_id, filename, bytes) VALUES (?,?,?,?,?)
  ON CONFLICT(conversation_id, filename) DO UPDATE SET bytes=excluded.bytes, created_at=datetime('now')
`);
const getFile = db.prepare("SELECT id, filename, bytes FROM files WHERE conversation_id=? AND filename=?");

/** If a tool result names output files (Word file and/or PDF), register them and tell the browser. */
function registerFileFromResult(ctx, resultText) {
  let obj;
  try { obj = JSON.parse(resultText); } catch { return; }
  if (!obj) return;
  const names = [obj.file, obj.pdf && obj.pdf.file].filter((n) => typeof n === "string");
  for (const name of names) {
    const filename = path.basename(name);
    const full = path.join(ctx.dir, "outputs", filename);
    if (!fs.existsSync(full)) continue;
    const bytes = fs.statSync(full).size;
    upsertFile.run(crypto.randomUUID(), ctx.conversationId, ctx.userId, filename, bytes);
    const row = getFile.get(ctx.conversationId, filename);
    emit(ctx.runId, { type: "file", file: { id: row.id, filename: row.filename, bytes: row.bytes } });
  }
}

const TOOL_LABELS = {
  doc_start: "Starting document",
  doc_add_section: "Writing section",
  doc_status: "Checking draft",
  doc_list: "Looking for earlier drafts",
  image_status: "Checking image tools",
  generate_image: "Creating a picture",
  doc_build: "Building Word and PDF files",
  save_file: "Saving file",
  web_search: "Searching the web",
};
const describeTool = (name, input) => {
  const base = TOOL_LABELS[name] || name;
  const detail = input?.title || input?.filename;
  return detail ? `${base}: ${String(detail).slice(0, 80)}` : base;
};

export async function runAgent(ctx) {
  const mcp = await connectMcp(ctx.dir);
  try {
    if (config.mockAi || !config.anthropicKey) {
      if (!config.mockAi) {
        throw new Error("ANTHROPIC_API_KEY is not set. Add it to server/.env, or set MOCK_AI=true to test the pipeline without Claude.");
      }
      return await runMock(ctx, mcp);
    }
    return await runClaude(ctx, mcp);
  } finally {
    await mcp.close();
  }
}

async function runClaude(ctx, mcp) {
  const client = new Anthropic({ apiKey: config.anthropicKey });
  const tools = mcp.tools.map((t) => ({ name: t.name, description: t.description || "", input_schema: t.inputSchema }));
  if (config.enableWebSearch) tools.push({ type: "web_search_20250305", name: "web_search", max_uses: 6 });

  const messages = loadHistory(ctx.conversationId);
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const system = [
    { type: "text", text: SYSTEM_PROMPT + `\n\nToday's date: ${new Date().toISOString().slice(0, 10)}.`, cache_control: { type: "ephemeral" } },
  ];

  for (let turn = 0; turn < config.maxTurns; turn++) {
    const stream = client.messages.stream({ model: config.model, max_tokens: config.maxTokens, system, tools, messages });
    stream.on("text", (delta) => emit(ctx.runId, { type: "text", delta }));
    const msg = await stream.finalMessage();

    usage.input += msg.usage?.input_tokens || 0;
    usage.output += msg.usage?.output_tokens || 0;
    usage.cacheRead += msg.usage?.cache_read_input_tokens || 0;
    usage.cacheWrite += msg.usage?.cache_creation_input_tokens || 0;

    if (msg.stop_reason === "max_tokens") {
      // A truncated tool call is not safe to save or execute.
      emit(ctx.runId, {
        type: "text",
        delta: "\n\n_That step was too long to finish. Ask me to continue (for example: “continue from the next chapter”)._",
      });
      return usage;
    }

    messages.push({ role: "assistant", content: msg.content });

    if (msg.stop_reason === "tool_use") {
      const results = [];
      for (const block of msg.content.filter((b) => b.type === "tool_use")) {
        emit(ctx.runId, { type: "tool", status: "start", callId: block.id, label: describeTool(block.name, block.input) });
        const r = await mcp.call(block.name, block.input).catch((e) => ({ text: `Tool error: ${e.message}`, isError: true }));
        if (!r.isError) registerFileFromResult(ctx, r.text);
        emit(ctx.runId, { type: "tool", status: r.isError ? "error" : "done", callId: block.id, label: describeTool(block.name, block.input) });
        results.push({ type: "tool_result", tool_use_id: block.id, content: r.text, is_error: r.isError });
      }
      messages.push({ role: "user", content: results });
      // Save the assistant tool_use and its tool_result TOGETHER so history is never left half-finished.
      persist(ctx.conversationId, "assistant", msg.content);
      persist(ctx.conversationId, "user", results);
      continue;
    }

    persist(ctx.conversationId, "assistant", msg.content);
    if (msg.stop_reason === "pause_turn") continue; // server-side tool (web search) wants to continue
    return usage;
  }

  emit(ctx.runId, { type: "text", delta: "\n\n_I stopped because this run used the maximum number of steps. Ask me to continue where I left off._" });
  return usage;
}

// ---------------------------------------------------------------------------
// MOCK_AI mode: exercises the full pipeline (MCP tools, files, SSE, credits)
// without calling Claude. Output is obviously sample content.
// ---------------------------------------------------------------------------
async function runMock(ctx, mcp) {
  const last = loadHistory(ctx.conversationId).filter((m) => m.role === "user" && typeof m.content === "string").pop();
  const topic = (last?.content || "your topic").slice(0, 60);
  const say = async (t) => { for (const w of t.split(/(\s+)/)) { emit(ctx.runId, { type: "text", delta: w }); await new Promise((r) => setTimeout(r, 4)); } };
  const tool = async (name, input) => {
    emit(ctx.runId, { type: "tool", status: "start", callId: name, label: describeTool(name, input) });
    const r = await mcp.call(name, input);
    if (r.isError) throw new Error(r.text);
    registerFileFromResult(ctx, r.text);
    emit(ctx.runId, { type: "tool", status: "done", callId: name, label: describeTool(name, input) });
    return JSON.parse(r.text);
  };

  await say(`🧠 **Super Agent (mock mode)** — sample run for "${topic}". No AI model is being called; this checks the pipeline.\n\n🔍 Research Agent… ✍️ Writer Agent…\n\n`);
  const { docId } = await tool("doc_start", { title: `Sample Book: ${topic}`, subtitle: "Generated in MOCK_AI mode", author: "Digital Product Studio", primary_color: "1F3A5F", accent_color: "E07A1F" });
  await tool("doc_add_section", { docId, kind: "front", title: "A Letter from the Author", blocks: [{ type: "paragraph", text: "This is **sample content** produced without an AI model, to prove the pipeline works end to end." }] });
  for (let i = 1; i <= 3; i++) {
    await tool("doc_add_section", {
      docId, kind: "chapter", title: `Sample Chapter ${i}`, subtitle: "Placeholder subtitle",
      blocks: [
        { type: "paragraph", text: `Sample story paragraph for chapter ${i} about ${topic}.` },
        { type: "quote", text: "Sample quote (not real).", attribution: "Mock Author" },
        { type: "heading", level: 2, text: "The Framework" },
        { type: "table", headers: ["Step", "Action"], rows: [["1", "Do this"], ["2", "Do that"]] },
        { type: "callout", title: "Micro-challenge", text: "Try one step today." },
        { type: "checklist", items: ["Action one", "Action two", "Action three"] },
      ],
    });
  }
  await say("📘 Publisher Agent building the Word file…\n\n");
  const built = await tool("doc_build", { docId });
  await tool("save_file", { filename: "landing-page.html", content: `<!doctype html><meta charset="utf-8"><title>${topic.replace(/[<>&]/g, "")}</title><h1>Sample landing page</h1><p>Mock output.</p>` });
  await say(`✅ Done. Built **${built.file}** (${built.chapters} sample chapters) and a sample landing page. Switch off MOCK_AI and add your ANTHROPIC_API_KEY for real books.`);
  persist(ctx.conversationId, "assistant", [{ type: "text", text: `Mock run finished for "${topic}". Files: ${built.file}, landing-page.html.` }]);
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}
