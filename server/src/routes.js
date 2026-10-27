import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { runAgent, projectDir } from "./agent.js";
import { requireAuth } from "./auth.js";
import { config } from "./config.js";
import { adjustCredits, db } from "./db.js";
import { activeRunFor, createRun, emit, finishRun, runExists, subscribe } from "./events.js";

export const apiRouter = Router();
apiRouter.use(requireAuth);

const ownConversation = (userId, id) => db.prepare("SELECT * FROM conversations WHERE id=? AND user_id=?").get(id, userId);

// ---------- projects (conversations) ----------

apiRouter.get("/conversations", (req, res) => {
  const rows = db
    .prepare("SELECT id, title, created_at, updated_at FROM conversations WHERE user_id=? ORDER BY updated_at DESC LIMIT 200")
    .all(req.user.id);
  res.json({ conversations: rows });
});

apiRouter.post("/conversations", (req, res) => {
  const title = z.string().trim().max(120).catch("New product").parse(req.body?.title) || "New product";
  const id = crypto.randomUUID();
  const create = db.transaction(() => {
    const balance = adjustCredits(req.user.id, -config.projectCreditCost, "new_project", id);
    if (balance === null) return null;
    db.prepare("INSERT INTO conversations (id, user_id, title) VALUES (?,?,?)").run(id, req.user.id, title);
    return balance;
  });
  const balance = create();
  if (balance === null) return res.status(402).json({ error: "You are out of credits. Buy credits to start a new product." });
  res.status(201).json({ conversation: { id, title }, credits: balance });
});

apiRouter.get("/conversations/:id", (req, res) => {
  const conv = ownConversation(req.user.id, req.params.id);
  if (!conv) return res.status(404).json({ error: "Not found" });

  const messages = db
    .prepare("SELECT role, content FROM messages WHERE conversation_id=? ORDER BY id")
    .all(conv.id)
    .map((m) => ({ role: m.role, content: JSON.parse(m.content) }))
    .map((m) => {
      if (m.role === "user" && typeof m.content === "string") return { role: "user", text: m.content };
      if (m.role === "assistant" && Array.isArray(m.content)) {
        const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("");
        return text.trim() ? { role: "assistant", text } : null;
      }
      return null;
    })
    .filter(Boolean);

  const files = db.prepare("SELECT id, filename, bytes, created_at FROM files WHERE conversation_id=? ORDER BY created_at").all(conv.id);
  const usage = db
    .prepare("SELECT COUNT(*) runs, COALESCE(SUM(input_tokens),0) input, COALESCE(SUM(output_tokens),0) output FROM runs WHERE conversation_id=?")
    .get(conv.id);
  // Only report an active run if it belongs to THIS project
  const activeId = activeRunFor(req.user.id);
  const activeRunId =
    activeId && db.prepare("SELECT 1 FROM runs WHERE id=? AND conversation_id=? AND status='running'").get(activeId, conv.id) ? activeId : null;
  res.json({ conversation: { id: conv.id, title: conv.title }, messages, files, usage, activeRunId });
});

// ---------- messages & runs ----------

const messageLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many messages this hour. Please wait a bit." },
});

apiRouter.post("/conversations/:id/messages", messageLimiter, (req, res) => {
  const conv = ownConversation(req.user.id, req.params.id);
  if (!conv) return res.status(404).json({ error: "Not found" });
  const parsed = z.object({ text: z.string().trim().min(1).max(8000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Write a message (up to 8,000 characters)." });
  if (activeRunFor(req.user.id)) return res.status(409).json({ error: "Your previous request is still running. Please wait for it to finish." });

  const runCount = db.prepare("SELECT COUNT(*) n FROM runs WHERE conversation_id=?").get(conv.id).n;
  if (runCount >= config.maxRunsPerProject) {
    return res.status(429).json({ error: `This product reached its limit of ${config.maxRunsPerProject} requests. Start a new product to continue.` });
  }

  const runId = crypto.randomUUID();
  db.prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?,?,?)").run(conv.id, "user", JSON.stringify(parsed.data.text));
  db.prepare("INSERT INTO runs (id, conversation_id, user_id, status) VALUES (?,?,?, 'running')").run(runId, conv.id, req.user.id);
  db.prepare("UPDATE conversations SET updated_at=datetime('now') WHERE id=?").run(conv.id);
  if (conv.title === "New product") {
    db.prepare("UPDATE conversations SET title=? WHERE id=?").run(parsed.data.text.slice(0, 60), conv.id);
  }

  createRun(runId, req.user.id);
  const dir = projectDir(req.user.id, conv.id);
  fs.mkdirSync(dir, { recursive: true });

  // Run in the background; the browser follows progress over SSE.
  (async () => {
    try {
      const usage = await runAgent({ runId, userId: req.user.id, conversationId: conv.id, dir });
      db.prepare(
        "UPDATE runs SET status='done', input_tokens=?, output_tokens=?, cache_read_tokens=?, cache_write_tokens=?, finished_at=datetime('now') WHERE id=?"
      ).run(usage.input, usage.output, usage.cacheRead, usage.cacheWrite, runId);
      emit(runId, { type: "done" });
    } catch (e) {
      console.error(`[run ${runId}]`, e);
      const friendly = friendlyError(e);
      db.prepare("UPDATE runs SET status='failed', error=?, finished_at=datetime('now') WHERE id=?").run(String(e?.message || e).slice(0, 500), runId);
      emit(runId, { type: "error", message: friendly });
    } finally {
      finishRun(runId, req.user.id);
    }
  })();

  res.status(202).json({ runId });
});

function friendlyError(e) {
  const msg = String(e?.message || e);
  if (/ANTHROPIC_API_KEY/.test(msg)) return msg;
  if (e?.status === 401) return "The server's Anthropic API key was rejected. Check ANTHROPIC_API_KEY in server/.env.";
  if (e?.status === 429) return "The AI service is busy or over its rate limit. Please try again in a minute.";
  if (e?.status === 400 && /credit balance/i.test(msg)) return "The Anthropic account has no remaining credit balance.";
  if (e?.status === 404) return "The configured Claude model was not found. Check CLAUDE_MODEL in server/.env.";
  return "Something went wrong while building your product. Your earlier files are safe. Try again.";
}

apiRouter.get("/runs/:runId/stream", (req, res) => {
  const { runId } = req.params;
  const run = db.prepare("SELECT user_id FROM runs WHERE id=?").get(runId);
  if (!run || run.user_id !== req.user.id) return res.status(404).json({ error: "Not found" });
  if (!runExists(runId)) return res.status(410).json({ error: "This run has already finished." });

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const send = (e) => {
    res.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
    if (e.type === "done" || e.type === "error") setImmediate(() => res.end());
  };
  const sub = subscribe(runId, send);
  if (!sub) return res.end();
  if (sub.done) return res.end(); // finished run: history replayed, nothing more will come
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => { clearInterval(heartbeat); sub.unsubscribe(); });
});

// ---------- files ----------

apiRouter.get("/files/:id/download", (req, res) => {
  const f = db.prepare("SELECT * FROM files WHERE id=? AND user_id=?").get(req.params.id, req.user.id);
  if (!f) return res.status(404).json({ error: "File not found" });
  const full = path.join(projectDir(f.user_id, f.conversation_id), "outputs", path.basename(f.filename));
  if (!fs.existsSync(full)) return res.status(404).json({ error: "File is no longer available" });
  res.download(full, f.filename);
});
