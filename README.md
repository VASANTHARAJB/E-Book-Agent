# Digital Product Studio — SaaS starter

A website where a customer chats with an AI "product studio" and downloads a finished, **editable** digital product:
a 12-chapter ebook (`.docx` and a matching `.pdf`), a landing page (`.html`), an ad strategy (`.docx`) and a go-to-market playbook (`.docx`).

```
Browser (Next.js, port 3000)
   │  login, chat, live progress (SSE), downloads
   ▼
Express API (port 4000) ── SQLite (users, credits, projects, runs, files)
   │  runs the agent loop with the Claude API
   │  spawns ONE local MCP server per run (stdio), scoped to that project's folder
   ▼
MCP server (mcp/)  →  tools: doc_start · doc_add_section · doc_status · doc_list · doc_build · save_file
   writes real .docx / .html files into  server/data/users/<user>/<project>/outputs
```

The system prompt (the "skill") lives in `server/src/prompts/studio.md`. Edit it to change how the team behaves.

## What is tested and what is not

Tested on my side before packaging:
- MCP server: all 6 tools over stdio, validation errors, generated `.docx` opens and renders (LibreOffice).
- API: signup/login, credits, project creation, run → live SSE stream → files → authenticated download, other users blocked (404).
- Claude tool loop: exercised against a **fake** Anthropic server that speaks the streaming protocol (text, tool calls, tool errors, history replay across two runs, token accounting).
- Web app: `next build` passes; a real browser walked signup → new product → run → download → out-of-credits modal → reload.

**Tested by the author on Linux:** Word + PDF output in all three style kits (rendered and checked page by page). **Not tested:** Word itself (only LibreOffice was available), PDF export on Windows, Docker, a call to the real Claude API from this build, Razorpay with live or test keys, web search. Expect to fix small things on first contact with those. Start with `MOCK_AI=true`, then switch to your key.

## Requirements

- Node.js **22.13 or newer** (the database is Node's built-in SQLite, so nothing is compiled and no Visual Studio / Python / C++ tools are needed), npm 10+
- Windows, macOS and Linux all work. On Windows, install the project on a normal local drive (for example `C:\projects\`), not a network or mapped drive.
- For PDF files: **LibreOffice** (free, https://www.libreoffice.org/download) installed on the machine that runs the server. Without it the Word file is still built and the app tells the customer the PDF could not be made. If it is installed in an unusual place, set `SOFFICE_PATH` to the full path of `soffice.exe`.
- For real books: an Anthropic API key from https://console.anthropic.com (billed per use, separate from a claude.ai subscription)

## Quick start (about 5 minutes)

```bash
# 1. install everything (installs mcp/, server/ and web/ together)
npm install

# 2. server settings
cp server/.env.example server/.env        # Windows PowerShell:  copy server\.env.example server\.env
#    open server/.env and set:
#      JWT_SECRET=<long random string>
#      MOCK_AI=true            <- first run: no AI calls, proves the whole pipeline
#    later: MOCK_AI=false and ANTHROPIC_API_KEY=sk-ant-...

# 3. web settings (defaults already work locally, this step is optional)
cp web/.env.example web/.env.local        # Windows PowerShell:  copy web\.env.example web\.env.local

# 4. run API + website together
npm run dev
```

Open http://localhost:3000, create an account (you get `SIGNUP_CREDITS` free credits), click **New product**, send a message.
In mock mode you get sample files in seconds; with a real key you get a real book.

Check the API mode any time: http://localhost:4000/health

## Connecting the MCP server locally

**A. Automatic (what the app does).** The API starts `mcp/src/index.js` itself for every run and talks to it over stdio.
You do not start it by hand.

**B. Use the same tools inside Claude Desktop** (to test or to use the tools without the website). Edit Claude Desktop's config
(Settings → Developer → Edit Config) and add, using your **absolute** paths:

```json
{
  "mcpServers": {
    "product-studio": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/digital-product-studio-saas/mcp/src/index.js"],
      "env": { "STUDIO_STORAGE_DIR": "/ABSOLUTE/PATH/TO/digital-product-studio-saas/mcp/storage/local" }
    }
  }
}
```

Windows example: `"args": ["C:\\Users\\you\\digital-product-studio-saas\\mcp\\src\\index.js"]` and
`"STUDIO_STORAGE_DIR": "C:\\Users\\you\\digital-product-studio-saas\\mcp\\storage\\local"`. Restart Claude Desktop.
Built files appear in `<STUDIO_STORAGE_DIR>/outputs`.

**C. Inspect the tools in a browser:** `npx @modelcontextprotocol/inspector node mcp/src/index.js`

**D. Smoke test:** `npm run test:mcp`

## Pictures (optional)

By default the cover and chapter banners are drawn by the app (free, no keys). For AI pictures, put `OPENAI_API_KEY` and/or `GEMINI_API_KEY` in `server/.env` and restart. The agent then offers AI pictures only when a customer asks for them; each picture is billed by the provider. The studio checks which image model your account can use (override with `OPENAI_IMAGE_MODEL` / `GEMINI_IMAGE_MODEL`). OpenAI may require organization verification in its console before GPT Image models work. **Not tested against the real OpenAI/Gemini services**, only against local stand-ins that mimic their responses; the first real picture may need a small fix. If one provider fails, the studio tries the other.

## How credits work (change to suit your business)

- `SIGNUP_CREDITS` free credits at signup (set to 0 to disable).
- Creating a product ("project") costs `PROJECT_CREDIT_COST` credits. Messages inside that project are free, up to `MAX_RUNS_PER_PROJECT`.
- Packs are set in `CREDIT_PACKS` (credits:rupees). **Do not set prices until you know your real cost per book** (next section).
- With Razorpay keys set, the **Add** button opens Razorpay Checkout; payments are confirmed by signature check and, if you configure the webhook, server-to-server.
  Webhook URL: `https://<your-api>/api/billing/webhook` (events `payment.captured` / `order.paid`).
- For local testing, `DEV_GRANT=true` shows a button that adds free test credits. It is ignored when `NODE_ENV=production`.

## Measure your cost per book

Every run stores its token usage. After a few real runs, from the project root:

```bash
npm run usage
```

Multiply by your model's current per-token prices (see Anthropic's pricing page), add a margin, and only then fix `CREDIT_PACKS`.
Note that the whole conversation is re-sent on every step, so long projects cost more per step; `MAX_RUNS_PER_PROJECT` caps this.

## Project layout

```
mcp/      MCP server (docx builder + tools) and smoke test
server/   Express API: auth, credits, agent loop, SSE, downloads, Razorpay
web/      Next.js app: landing page, login/register, studio (chat) UI
```

## Troubleshooting

- **`ExperimentalWarning: SQLite is an experimental feature`** when the API starts: harmless. It is Node's built-in SQLite; the warning is just Node's label.
- **`npm install` fails with `EPERM ... rmdir` (Windows):** a file was locked while npm cleaned up, usually by antivirus, OneDrive/cloud sync, or a network/mapped drive. Close editors, move the project to a local folder such as `C:\projects\`, delete the half-installed `node_modules` folder (`Remove-Item -Recurse -Force node_modules` in PowerShell), then run `npm install` again.
- **`Cannot reach the server` in the browser:** the API is not running, or `NEXT_PUBLIC_API_URL` / `WEB_ORIGIN` do not match the addresses you are using.
- **Port already in use:** change `PORT` in `server/.env` (and `NEXT_PUBLIC_API_URL` in `web/.env.local`), or stop the other program.
- **Database on a network drive:** keep `server/data` on a local disk (`DATA_DIR` in `server/.env`). WAL mode is off by default for safety (`SQLITE_WAL=true` turns it on for local disks).

## Before you put this on the internet

- Set a real `JWT_SECRET` (32+ chars), `NODE_ENV=production`, `DEV_GRANT=false`, serve both apps over HTTPS.
  If web and API are on different subdomains, set `COOKIE_DOMAIN=.yourdomain.com` and `WEB_ORIGIN` to the web address.
- Add: email verification and password reset, Terms of Service and Privacy Policy, a refund policy, backups of `server/data`.
- Check Anthropic's usage policy and commercial terms for products built on the API, and tax/GST treatment of your sales with your accountant.
- Review AI output quality yourself on several topics before selling. The system prompt forbids invented quotes, but verify.

## Known limitations (honest list)

- Run progress is held in server memory: run the API as **one process**. Scaling out needs a shared queue/event store (Redis, BullMQ, etc.).
- Node's built-in SQLite is still marked experimental by Node, and local disk storage is fine for a pilot; move to Postgres + object storage (S3/R2) before real traffic.
- Artwork: the cover and chapter banners are abstract shapes drawn by the app in one of 3 style kits. Optional AI pictures (OpenAI / Gemini) are included but untested against the live services. Canva export is a planned extension, not included.
- Word asks "update fields?" the first time a book is opened; click Yes so the contents page gets its page numbers (the PDF already has them).
- No project deletion, admin panel, or team accounts yet.
- Rate limits are in-memory and per process.
- Page counts reported by the agent are estimates; Word shows the real count.
#   E - B o o k - A g e n t  
 