import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");

// Load server/.env if present (Node >= 20.12)
try {
  process.loadEnvFile(path.join(serverRoot, ".env"));
} catch {
  /* no .env file: rely on real environment variables */
}

const env = process.env;
const bool = (v, d = false) => (v === undefined || v === "" ? d : ["1", "true", "yes", "on"].includes(String(v).toLowerCase()));
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

const isProd = env.NODE_ENV === "production";

if (isProd && (!env.JWT_SECRET || env.JWT_SECRET.length < 32)) {
  console.error("FATAL: set JWT_SECRET (32+ random characters) in production.");
  process.exit(1);
}

// "credits:priceInRupees" pairs, e.g. "1:499,5:1999,12:3999"
function parsePacks(s) {
  return String(s || "1:499,5:1999,12:3999")
    .split(",")
    .map((p) => p.trim().split(":"))
    .filter((p) => p.length === 2)
    .map(([credits, inr]) => ({ id: `pack_${credits}`, credits: int(credits, 0), amountInr: int(inr, 0) }))
    .filter((p) => p.credits > 0 && p.amountInr > 0);
}

export const config = {
  isProd,
  port: int(env.PORT, 4000),
  webOrigin: env.WEB_ORIGIN || "http://localhost:3000",
  cookieDomain: env.COOKIE_DOMAIN || undefined,
  jwtSecret: env.JWT_SECRET || "dev-only-secret-change-me-dev-only-secret",
  dataDir: path.resolve(env.DATA_DIR || path.join(serverRoot, "data")),
  mcpEntry: path.resolve(env.MCP_ENTRY || path.join(serverRoot, "..", "mcp", "src", "index.js")),

  anthropicKey: env.ANTHROPIC_API_KEY || "",
  model: env.CLAUDE_MODEL || "claude-sonnet-5-5",
  maxTokens: int(env.MAX_TOKENS, 16000),
  maxTurns: int(env.MAX_AGENT_TURNS, 60),
  enableWebSearch: bool(env.ENABLE_WEB_SEARCH, false),
  mockAi: bool(env.MOCK_AI, false),

  signupCredits: int(env.SIGNUP_CREDITS, 1),
  projectCreditCost: int(env.PROJECT_CREDIT_COST, 1),
  maxRunsPerProject: int(env.MAX_RUNS_PER_PROJECT, 25),

  razorpayKeyId: env.RAZORPAY_KEY_ID || "",
  razorpayKeySecret: env.RAZORPAY_KEY_SECRET || "",
  razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET || "",
  creditPacks: parsePacks(env.CREDIT_PACKS),
  devGrant: bool(env.DEV_GRANT, false) && !isProd,
};

export const paymentsEnabled = () => !!(config.razorpayKeyId && config.razorpayKeySecret);
