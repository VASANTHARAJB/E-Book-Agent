import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { config, paymentsEnabled } from "./config.js";
import { adjustCredits, db } from "./db.js";

// NOTE: the Razorpay parts follow Razorpay's documented Orders + signature-verification flow
// but have NOT been run against live keys. Test in Razorpay test mode first.

export const billingRouter = Router();

const hmac = (secret, payload) => crypto.createHmac("sha256", secret).update(payload).digest("hex");
const safeEqual = (a, b) => {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

/** Credit a paid order exactly once. */
const creditOrder = db.transaction((orderId, paymentId) => {
  const changed = db.prepare("UPDATE payments SET status='paid', payment_id=? WHERE order_id=? AND status='created'").run(paymentId, orderId).changes;
  if (!changed) return null; // already processed
  const p = db.prepare("SELECT user_id, credits FROM payments WHERE order_id=?").get(orderId);
  return adjustCredits(p.user_id, p.credits, "purchase", orderId);
});

billingRouter.get("/packs", requireAuth, (_req, res) => {
  res.json({ packs: config.creditPacks, paymentsEnabled: paymentsEnabled(), devGrant: config.devGrant, projectCreditCost: config.projectCreditCost });
});

billingRouter.post("/order", requireAuth, async (req, res) => {
  if (!paymentsEnabled()) return res.status(503).json({ error: "Payments are not configured on this server yet." });
  const parsed = z.object({ packId: z.string() }).safeParse(req.body);
  const pack = parsed.success && config.creditPacks.find((p) => p.id === parsed.data.packId);
  if (!pack) return res.status(400).json({ error: "Unknown credit pack." });

  try {
    const amount = pack.amountInr * 100; // paise
    const r = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(`${config.razorpayKeyId}:${config.razorpayKeySecret}`).toString("base64"),
      },
      body: JSON.stringify({ amount, currency: "INR", receipt: `u_${req.user.id.slice(0, 8)}_${Date.now()}`, notes: { userId: req.user.id, packId: pack.id } }),
    });
    const order = await r.json();
    if (!r.ok) {
      console.error("[razorpay order]", order);
      return res.status(502).json({ error: "Could not create the payment order. Please try again." });
    }
    db.prepare("INSERT INTO payments (order_id, user_id, pack_id, credits, amount_paise, status) VALUES (?,?,?,?,?, 'created')").run(
      order.id, req.user.id, pack.id, pack.credits, amount
    );
    res.json({ orderId: order.id, amount, currency: "INR", keyId: config.razorpayKeyId, name: "Digital Product Studio", description: `${pack.credits} credit${pack.credits > 1 ? "s" : ""}` });
  } catch (e) {
    console.error("[razorpay order]", e);
    res.status(502).json({ error: "Could not reach the payment provider." });
  }
});

// Browser-side confirmation after checkout succeeds
billingRouter.post("/verify", requireAuth, (req, res) => {
  if (!paymentsEnabled()) return res.status(503).json({ error: "Payments are not configured." });
  const parsed = z.object({ razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payment data." });
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig } = parsed.data;

  const payment = db.prepare("SELECT * FROM payments WHERE order_id=? AND user_id=?").get(orderId, req.user.id);
  if (!payment) return res.status(404).json({ error: "Order not found." });
  if (!safeEqual(hmac(config.razorpayKeySecret, `${orderId}|${paymentId}`), sig)) return res.status(400).json({ error: "Payment signature check failed." });

  creditOrder(orderId, paymentId); // idempotent: the webhook may have credited it already
  const credits = db.prepare("SELECT credits FROM users WHERE id=?").get(req.user.id).credits;
  res.json({ ok: true, credits });
});

// Server-to-server confirmation (covers the case where the buyer closes the tab). Mounted with a raw body parser in index.js.
export function razorpayWebhook(req, res) {
  if (!config.razorpayWebhookSecret) return res.status(503).end();
  const raw = req.body; // Buffer
  const sig = req.get("x-razorpay-signature") || "";
  if (!Buffer.isBuffer(raw) || !safeEqual(hmac(config.razorpayWebhookSecret, raw), sig)) return res.status(400).end();
  try {
    const evt = JSON.parse(raw.toString("utf8"));
    if (evt.event === "payment.captured" || evt.event === "order.paid") {
      const pay = evt.payload?.payment?.entity;
      const orderId = pay?.order_id || evt.payload?.order?.entity?.id;
      if (orderId) creditOrder(orderId, pay?.id || null);
    }
  } catch (e) {
    console.error("[razorpay webhook]", e);
  }
  res.json({ ok: true });
}

// Local testing only: grant credits without paying. Disabled unless DEV_GRANT=true and NODE_ENV != production.
billingRouter.post("/dev-grant", requireAuth, (req, res) => {
  if (!config.devGrant) return res.status(404).end();
  const credits = z.number().int().min(1).max(50).catch(5).parse(req.body?.credits);
  const balance = adjustCredits(req.user.id, credits, "dev_grant");
  res.json({ ok: true, credits: balance });
});
