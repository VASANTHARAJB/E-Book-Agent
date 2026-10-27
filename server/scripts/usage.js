// Prints token usage per project so you can work out your real cost per book.
// Run from the project root:  npm run usage
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../src/config.js";

const db = new DatabaseSync(path.join(config.dataDir, "studio.db"), { readOnly: true });
const rows = db
  .prepare(
    `SELECT c.title AS project, COUNT(r.id) AS runs,
            COALESCE(SUM(r.input_tokens),0) AS input_tokens,
            COALESCE(SUM(r.output_tokens),0) AS output_tokens,
            COALESCE(SUM(r.cache_read_tokens),0) AS cache_read_tokens,
            COALESCE(SUM(r.cache_write_tokens),0) AS cache_write_tokens
     FROM conversations c LEFT JOIN runs r ON r.conversation_id = c.id
     GROUP BY c.id ORDER BY c.created_at DESC LIMIT 50`
  )
  .all();
console.table(rows.map((r) => ({ ...r })));
console.log("Multiply by your model's current per-token prices (see Anthropic's pricing page), then add your margin.");
