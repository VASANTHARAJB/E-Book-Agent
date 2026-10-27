import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { authRouter } from "./auth.js";
import { billingRouter, razorpayWebhook } from "./billing.js";
import { config } from "./config.js";
import "./db.js";
import { apiRouter } from "./routes.js";

const app = express();
if (config.isProd) app.set("trust proxy", 1);

app.use(cors({ origin: config.webOrigin, credentials: true }));

// Razorpay webhook needs the exact raw bytes to verify its signature, so it is mounted BEFORE express.json().
app.post("/api/billing/webhook", express.raw({ type: "application/json", limit: "1mb" }), razorpayWebhook);

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.get("/health", (_req, res) =>
  res.json({ ok: true, mode: config.mockAi ? "mock" : config.anthropicKey ? "claude" : "no-api-key", model: config.model })
);

app.use("/api/auth", authRouter);
app.use("/api/billing", billingRouter);
app.use("/api", apiRouter);

app.use((req, res) => res.status(404).json({ error: "Not found" }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

app.listen(config.port, () => {
  const mode = config.mockAi ? "MOCK_AI (no Claude calls)" : config.anthropicKey ? `Claude (${config.model})` : "NO API KEY: set ANTHROPIC_API_KEY or MOCK_AI=true";
  console.log(`API listening on http://localhost:${config.port}  |  AI mode: ${mode}  |  web origin: ${config.webOrigin}`);
});
