// AI image generation through two providers: OpenAI (GPT Image models) and Google Gemini (image models).
// Model names change often, so the model is discovered from the account's own model list and can be overridden
// with OPENAI_IMAGE_MODEL / GEMINI_IMAGE_MODEL. API keys come from OPENAI_API_KEY / GEMINI_API_KEY and are only
// ever sent in request headers, never in URLs or tool results.

const clean = (v) => String(v || "").trim().replace(/^["']|["']$/g, "");
const openaiKey = () => clean(process.env.OPENAI_API_KEY);
const geminiKey = () => clean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
const openaiBase = () => clean(process.env.OPENAI_BASE_URL) || "https://api.openai.com/v1";
const geminiBase = () => clean(process.env.GEMINI_BASE_URL) || "https://generativelanguage.googleapis.com/v1beta";

// Best first. Checked against the account's model list; the first one the account can see is used.
const OPENAI_PREFERENCE = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2", "gpt-image-1.5", "gpt-image-1-mini"];
const GEMINI_PREFERENCE = ["gemini-nano-banana-2.1", "gemini-3.1-flash-lite-image", "gemini-3-pro-image", "gemini-3.1-flash-image", "gemini-2.5-flash-image"];

export const STYLE_SUFFIX =
  " Do not include any text, letters, numbers, captions, logos or watermarks in the image. Clean, professional composition suitable as a book illustration.";

async function http(url, { method = "GET", headers = {}, body, timeoutMs = 150000 } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const why = e?.name === "TimeoutError" ? "the request timed out" : e?.cause?.code || e?.message || "network error";
    throw new Error(`Could not reach the image service (${why}).`);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, json, text };
}

function apiError(provider, r) {
  const msg = r.json?.error?.message || r.json?.message || r.text || "";
  const short = String(msg).replace(/\s+/g, " ").slice(0, 300);
  if (r.status === 401 || r.status === 403) return new Error(`${provider} rejected the key or the request (HTTP ${r.status}). ${short}`);
  if (r.status === 429) return new Error(`${provider} rate limit or quota reached (HTTP 429). ${short}`);
  return new Error(`${provider} image request failed (HTTP ${r.status}). ${short}`);
}

// ---------- image size readers (PNG and JPEG) ----------
export function imageInfo(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { type: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: "jpg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

// ---------- OpenAI ----------
async function openaiModel() {
  const forced = clean(process.env.OPENAI_IMAGE_MODEL);
  if (forced) return forced;
  const r = await http(`${openaiBase()}/models`, { headers: { authorization: `Bearer ${openaiKey()}` }, timeoutMs: 30000 });
  if (!r.ok) throw apiError("OpenAI", r);
  const ids = new Set((r.json?.data || []).map((m) => m.id));
  return OPENAI_PREFERENCE.find((m) => ids.has(m)) || [...ids].filter((i) => /^gpt-image/.test(i)).sort().pop() || OPENAI_PREFERENCE[0];
}

function openaiSize(model, shape) {
  // Newer GPT Image models accept any WxH (multiples of 16, ratio up to 3:1); older ones only 3 fixed sizes.
  const flexible = /^gpt-image-2/.test(model) || model === "chatgpt-image-latest";
  if (shape === "banner") return flexible ? "1536x512" : "1536x1024";
  if (shape === "portrait") return "1024x1536";
  if (shape === "square") return "1024x1024";
  return "1536x1024"; // landscape
}

async function openaiGenerate({ prompt, shape, quality }) {
  const model = await openaiModel();
  const r = await http(`${openaiBase()}/images/generations`, {
    method: "POST",
    headers: { authorization: `Bearer ${openaiKey()}` },
    body: { model, prompt, size: openaiSize(model, shape), quality, n: 1, output_format: "png" },
  });
  if (!r.ok) throw apiError("OpenAI", r);
  const item = r.json?.data?.[0];
  if (item?.b64_json) return { model, buffer: Buffer.from(item.b64_json, "base64") };
  if (item?.url) {
    const img = await fetch(item.url, { signal: AbortSignal.timeout(60000) });
    return { model, buffer: Buffer.from(await img.arrayBuffer()) };
  }
  throw new Error("OpenAI returned no image (it may have been blocked by its safety system). Try a different description.");
}

// ---------- Gemini ----------
async function geminiModel() {
  const forced = clean(process.env.GEMINI_IMAGE_MODEL);
  if (forced) return forced.replace(/^models\//, "");
  const r = await http(`${geminiBase()}/models?pageSize=200`, { headers: { "x-goog-api-key": geminiKey() }, timeoutMs: 30000 });
  if (!r.ok) throw apiError("Gemini", r);
  const names = (r.json?.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent") && /image|banana/i.test(m.name))
    .map((m) => String(m.name).replace(/^models\//, ""));
  return GEMINI_PREFERENCE.find((m) => names.includes(m)) || names[0] || GEMINI_PREFERENCE[0];
}

const GEMINI_ASPECT = { banner: "21:9", landscape: "3:2", portrait: "2:3", square: "1:1" };

async function geminiGenerate({ prompt, shape }) {
  const model = await geminiModel();
  const url = `${geminiBase()}/models/${encodeURIComponent(model)}:generateContent`;
  const attempts = [
    { mods: ["IMAGE"], aspect: true },
    { mods: ["IMAGE"], aspect: false },
    { mods: ["TEXT", "IMAGE"], aspect: false },
  ];
  let last;
  for (const a of attempts) {
    const generationConfig = { responseModalities: a.mods };
    if (a.aspect) generationConfig.imageConfig = { aspectRatio: GEMINI_ASPECT[shape] || "3:2" };
    const text = a.aspect ? prompt : `${prompt} Aspect ratio ${GEMINI_ASPECT[shape] || "3:2"}.`;
    const r = await http(url, { method: "POST", headers: { "x-goog-api-key": geminiKey() }, body: { contents: [{ role: "user", parts: [{ text }] }], generationConfig } });
    if (r.ok) {
      const parts = r.json?.candidates?.[0]?.content?.parts || [];
      const img = parts.map((p) => p.inlineData || p.inline_data).find((d) => d && d.data);
      if (img) return { model, buffer: Buffer.from(img.data, "base64") };
      const why = r.json?.promptFeedback?.blockReason || r.json?.candidates?.[0]?.finishReason || "no image in the response";
      last = new Error(`Gemini returned no image (${why}). Try a different description.`);
      break; // a blocked/empty answer will not be fixed by changing the config
    }
    last = apiError("Gemini", r);
    if (r.status !== 400) break; // only config problems (HTTP 400) are worth retrying with a simpler config
  }
  throw last;
}

// ---------- public API ----------
export function configuredProviders() {
  return { openai: !!openaiKey(), gemini: !!geminiKey() };
}

export async function providerStatus() {
  const cfg = configuredProviders();
  const out = {};
  for (const [name, fn] of [["openai", openaiModel], ["gemini", geminiModel]]) {
    if (!cfg[name]) { out[name] = { configured: false }; continue; }
    try { out[name] = { configured: true, model: await fn() }; } catch (e) { out[name] = { configured: true, error: String(e.message || e) }; }
  }
  return out;
}

/**
 * Generate one image. provider: "auto" | "openai" | "gemini". With "auto", the first configured provider is tried and the
 * other one is used if the first fails. shape: "banner" | "landscape" | "portrait" | "square".
 */
export async function generateImage({ prompt, shape = "landscape", quality = "medium", provider = "auto" }) {
  const cfg = configuredProviders();
  const order = provider === "auto" ? ["openai", "gemini"].filter((p) => cfg[p]) : [provider];
  if (!order.length) throw new Error("No image provider is set up. Add OPENAI_API_KEY and/or GEMINI_API_KEY to the environment of the studio, then try again.");
  if (provider !== "auto" && !cfg[provider]) throw new Error(`${provider === "openai" ? "OpenAI" : "Gemini"} is not set up (missing ${provider === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY"}).`);
  const full = String(prompt).trim() + STYLE_SUFFIX;
  let firstError;
  for (const p of order) {
    try {
      const r = p === "openai" ? await openaiGenerate({ prompt: full, shape, quality }) : await geminiGenerate({ prompt: full, shape });
      const info = imageInfo(r.buffer);
      if (!info) throw new Error("The provider returned an image in a format this studio cannot place in a document.");
      return { provider: p, model: r.model, buffer: r.buffer, ...info, fellBackFrom: firstError ? order[0] : undefined, firstError: firstError ? String(firstError.message || firstError) : undefined };
    } catch (e) {
      firstError = firstError || e;
      if (order.length === 1 || p === order[order.length - 1]) throw e;
    }
  }
}
