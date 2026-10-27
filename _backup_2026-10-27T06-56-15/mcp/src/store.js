import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const mcpRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Every MCP process works inside ONE storage directory.
// The API spawns one MCP process per run with STUDIO_STORAGE_DIR set to that user's folder,
// which is what keeps users' drafts and files isolated from each other.
export function storageDir() {
  const dir = path.resolve(process.env.STUDIO_STORAGE_DIR || path.join(mcpRoot, "storage", "local"));
  fs.mkdirSync(path.join(dir, "drafts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "outputs"), { recursive: true });
  return dir;
}

export const draftsDir = () => path.join(storageDir(), "drafts");
export const outputsDir = () => path.join(storageDir(), "outputs");
export const assetsDir = () => {
  const d = path.join(storageDir(), "assets");
  fs.mkdirSync(d, { recursive: true });
  return d;
};

// Pictures a document uses (generated or added). Only plain file names inside the assets folder are ever read.
const ASSET_RE = /^[a-z0-9][a-z0-9._-]{0,99}\.(png|jpe?g)$/;

export function assetPath(name) {
  const n = String(name || "");
  if (!ASSET_RE.test(n)) throw new Error(`Invalid image file name "${n}". Use the file name returned by generate_image.`);
  return path.join(assetsDir(), n);
}

export function readAsset(name) {
  const p = assetPath(name);
  if (!fs.existsSync(p)) throw new Error(`Image "${name}" was not found. Generate it again with generate_image.`);
  return fs.readFileSync(p);
}

export function saveAsset(name, buf) {
  fs.writeFileSync(assetPath(name), buf);
}

const ID_RE = /^d_[a-f0-9]{12}$/;

export function newDocId() {
  return "d_" + crypto.randomBytes(6).toString("hex");
}

function draftPath(id) {
  if (!ID_RE.test(id)) throw new Error(`Invalid docId "${id}". Use the docId returned by doc_start.`);
  return path.join(draftsDir(), `${id}.json`);
}

export function loadDraft(id) {
  const p = draftPath(id);
  if (!fs.existsSync(p)) throw new Error(`No draft found for docId "${id}". Call doc_start first.`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function saveDraft(draft) {
  const p = draftPath(draft.id);
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(draft));
  fs.renameSync(tmp, p);
}

export function slugify(s) {
  return (
    String(s || "document")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "document"
  );
}

const SAFE_EXT = new Set([".html", ".md", ".txt", ".json", ".csv"]);

export function safeTextFilename(name) {
  const base = path.basename(String(name || "").trim());
  const ext = path.extname(base).toLowerCase();
  if (!SAFE_EXT.has(ext)) {
    throw new Error(`File type "${ext}" not allowed. Allowed: ${[...SAFE_EXT].join(", ")}`);
  }
  const stem = slugify(base.slice(0, base.length - ext.length));
  return stem + ext;
}
