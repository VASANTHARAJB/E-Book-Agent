"use client";

import { useEffect, useState } from "react";
import { api, APP_NAME, PacksResponse } from "@/lib/api";

type RazorpayOrder = { orderId: string; amount: number; currency: string; keyId: string; name: string; description: string };
type RazorpayResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type RazorpayCtor = new (opts: Record<string, unknown>) => { open: () => void };

function loadRazorpay(): Promise<RazorpayCtor> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { Razorpay?: RazorpayCtor };
    if (w.Razorpay) return resolve(w.Razorpay);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error("Checkout failed to load")));
    s.onerror = () => reject(new Error("Could not load the payment window"));
    document.body.appendChild(s);
  });
}

export default function BillingModal({ onClose, onCredits }: { onClose: () => void; onCredits: (n: number) => void }) {
  const [info, setInfo] = useState<PacksResponse | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<PacksResponse>("/billing/packs").then(setInfo).catch((e) => setMsg(e.message));
  }, []);

  async function buy(packId: string) {
    setMsg("");
    setBusy(true);
    try {
      const order = await api<RazorpayOrder>("/billing/order", { body: { packId } });
      const Razorpay = await loadRazorpay();
      const rzp = new Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: order.name || APP_NAME,
        description: order.description,
        order_id: order.orderId,
        handler: async (r: RazorpayResponse) => {
          try {
            const res = await api<{ credits: number }>("/billing/verify", { body: r });
            onCredits(res.credits);
            setMsg("Payment confirmed. Credits added.");
          } catch (e) {
            setMsg(e instanceof Error ? e.message : "Could not confirm the payment.");
          }
        },
      });
      rzp.open();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  async function devGrant() {
    setBusy(true);
    try {
      const res = await api<{ credits: number }>("/billing/dev-grant", { body: { credits: 5 } });
      onCredits(res.credits);
      setMsg("Added 5 test credits.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Buy credits">
        <h2 style={{ fontSize: "1.3rem" }}>Credits</h2>
        <p className="note">Each new product uses {info?.projectCreditCost ?? 1} credit.</p>
        {info?.paymentsEnabled &&
          info.packs.map((p) => (
            <div className="pack" key={p.id}>
              <div>
                <b>{p.credits} credit{p.credits > 1 ? "s" : ""}</b>
                <div className="note">₹{p.amountInr.toLocaleString("en-IN")}</div>
              </div>
              <button className="btn btn-primary btn-small" disabled={busy} onClick={() => buy(p.id)}>Buy</button>
            </div>
          ))}
        {info && !info.paymentsEnabled && <p className="note">Online payments are not switched on for this server yet.</p>}
        {info?.devGrant && (
          <button className="btn btn-ghost btn-small" disabled={busy} onClick={devGrant}>Add 5 free test credits (local only)</button>
        )}
        {msg && <p className="note" style={{ marginTop: 12 }}>{msg}</p>}
        <div style={{ marginTop: 16, textAlign: "right" }}>
          <button className="btn btn-ghost btn-small" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
