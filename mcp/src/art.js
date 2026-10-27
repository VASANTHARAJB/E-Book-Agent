// Code-drawn artwork (no AI image API, no native modules): a tiny anti-aliased rasteriser that writes PNG files.
// Used for book covers and chapter banners, so every book from a style kit looks like one designed family, at zero cost.
import zlib from "node:zlib";

const rgb = (h) => {
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lerp = (a, b, t) => a + (b - a) * t;
const mixC = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const WHITE = [255, 255, 255];
const cov = (d) => Math.min(1, Math.max(0, 0.5 - d)); // 1px anti-aliasing from a signed distance

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Float32Array(w * h * 3);
  }
  gradient(top, bottom) {
    for (let y = 0; y < this.h; y++) {
      const c = mixC(top, bottom, y / (this.h - 1));
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 3;
        this.px[i] = c[0];
        this.px[i + 1] = c[1];
        this.px[i + 2] = c[2];
      }
    }
  }
  _put(i, c, a) {
    if (a <= 0) return;
    const p = this.px;
    p[i] += (c[0] - p[i]) * a;
    p[i + 1] += (c[1] - p[i + 1]) * a;
    p[i + 2] += (c[2] - p[i + 2]) * a;
  }
  _loop(x0, y0, x1, y1, fn, c, alpha) {
    const xa = Math.max(0, Math.floor(x0)), xb = Math.min(this.w - 1, Math.ceil(x1));
    const ya = Math.max(0, Math.floor(y0)), yb = Math.min(this.h - 1, Math.ceil(y1));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const a = fn(x + 0.5, y + 0.5) * alpha;
        if (a > 0.002) this._put((y * this.w + x) * 3, c, a);
      }
    }
  }
  circle(cx, cy, r, c, alpha = 1) {
    this._loop(cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2, (x, y) => cov(Math.hypot(x - cx, y - cy) - r), c, alpha);
  }
  ring(cx, cy, r, width, c, alpha = 1) {
    const o = r + width;
    this._loop(cx - o - 2, cy - o - 2, cx + o + 2, cy + o + 2, (x, y) => cov(Math.abs(Math.hypot(x - cx, y - cy) - r) - width / 2), c, alpha);
  }
  glow(cx, cy, r, c, alpha = 1) {
    this._loop(cx - r, cy - r, cx + r, cy + r, (x, y) => {
      const t = Math.hypot(x - cx, y - cy) / r;
      return t >= 1 ? 0 : (1 - t) * (1 - t);
    }, c, alpha);
  }
  _rrDist(x, y, cx, cy, hw, hh, rad) {
    const qx = Math.abs(x - cx) - (hw - rad), qy = Math.abs(y - cy) - (hh - rad);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
  }
  rrFill(cx, cy, hw, hh, rad, c, alpha = 1) {
    this._loop(cx - hw - 2, cy - hh - 2, cx + hw + 2, cy + hh + 2, (x, y) => cov(this._rrDist(x, y, cx, cy, hw, hh, rad)), c, alpha);
  }
  rrStroke(cx, cy, hw, hh, rad, width, c, alpha = 1) {
    this._loop(cx - hw - 2, cy - hh - 2, cx + hw + 2, cy + hh + 2, (x, y) => cov(Math.abs(this._rrDist(x, y, cx, cy, hw, hh, rad)) - width / 2), c, alpha);
  }
  toPNG() {
    const { w, h, px } = this;
    const raw = Buffer.alloc((w * 3 + 1) * h);
    let o = 0;
    for (let y = 0; y < h; y++) {
      raw[o++] = 0;
      for (let x = 0; x < w * 3; x++) raw[o++] = Math.max(0, Math.min(255, Math.round(px[y * w * 3 + x])));
    }
    const chunk = (type, data) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(td));
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // RGB
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

let CRC_TABLE;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Full-page cover artwork (no text: the title is typeset in the document so it stays editable). */
export function coverArt(kit, W, H, seed = 1, opts = {}) {
  const cv = new Canvas(W, H);
  const top = rgb(kit.coverTop), bottom = rgb(kit.coverBottom), accent = rgb(kit.accent);
  const line = mixC(top, WHITE, 0.28);
  cv.gradient(top, bottom);
  if (opts.plain) return cv.toPNG(); // colour gradient only (a photo/illustration is placed on top in the document)
  const rand = rng(seed);
  const fx = W / 2, fy = H * 0.27;

  if (kit.coverArt === "rings") {
    for (let i = 1; i <= 5; i++) cv.ring(fx, fy, W * 0.115 * i, Math.max(1.5, W * 0.0017), line, 0.7);
    cv.glow(fx, fy, W * 0.14, accent, 0.35);
    cv.circle(fx, fy, W * 0.033, accent, 1);
  } else if (kit.coverArt === "dots") {
    const step = W * 0.055;
    for (let y = step; y < H * 0.62; y += step) {
      for (let x = step / 2; x < W; x += step) {
        const d = Math.hypot(x - fx, y - fy) / (W * 0.6);
        const r = Math.max(1.2, step * 0.2 * (1 - Math.min(1, d)) + 1.6);
        cv.circle(x, y, r, d < 0.18 ? accent : line, Math.max(0.12, 0.85 - d));
      }
    }
    cv.glow(fx, fy, W * 0.14, accent, 0.4);
    cv.circle(fx, fy, W * 0.033, accent, 1);
  } else {
    // arcs
    for (let i = 0; i < 7; i++) {
      const r = W * (0.18 + rand() * 0.55);
      cv.ring(W * (0.35 + rand() * 0.6), H * (0.05 + rand() * 0.4), r, Math.max(1.5, W * 0.0017), line, 0.5);
    }
    cv.glow(W * 0.62, H * 0.24, W * 0.14, accent, 0.35);
    cv.circle(W * 0.62, H * 0.24, W * 0.033, accent, 1);
  }
  return cv.toPNG();
}

/** Chapter banner. t = 0..1 is the chapter's progress through the book: early chapters look busy, later ones calm and focused. */
export function bannerArt(kit, W, H, seed = 1, t = 0) {
  const cv = new Canvas(W, H);
  const top = rgb(kit.coverTop), bottom = rgb(kit.coverBottom), accent = rgb(kit.accent);
  const line = mixC(top, WHITE, 0.3);
  cv.gradient(top, bottom);
  const rand = rng(seed);
  const cx = W / 2, cy = H / 2;

  if (kit.bannerArt === "cards") {
    const n = Math.round(lerp(22, 3, t));
    const spread = lerp(0.46, 0.1, t);
    for (let i = 0; i < n; i++) {
      const hw = W * (0.07 + rand() * 0.1), hh = H * (0.14 + rand() * 0.22);
      const x = cx + (rand() - 0.5) * 2 * W * spread, y = cy + (rand() - 0.5) * 2 * H * 0.3;
      cv.rrFill(x, y, hw, hh, 6, line, 0.06);
      cv.rrStroke(x, y, hw, hh, 6, Math.max(1.2, H * 0.006), line, 0.4);
    }
  } else if (kit.bannerArt === "dots") {
    const cols = 30, rows = 7, pull = lerp(0.05, 0.7, t);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const gx = W * (0.04 + (0.92 * c) / (cols - 1)), gy = H * (0.12 + (0.76 * r) / (rows - 1));
        const x = lerp(gx, cx, pull), y = lerp(gy, cy, pull);
        cv.circle(x, y, Math.max(1.4, H * 0.012), line, 0.5);
      }
    }
  } else {
    // rings
    const ox = cx + (rand() - 0.5) * W * 0.2 * (1 - t);
    for (let i = 1; i <= 6; i++) cv.ring(ox, cy, H * 0.22 * i, Math.max(1.2, H * 0.006), line, 0.55);
    cv.glow(ox, cy, H * 0.45, accent, 0.25);
    cv.circle(ox, cy, H * 0.045, accent, 1);
    return cv.toPNG();
  }
  cv.glow(cx, cy, H * 0.55, accent, 0.4);
  cv.circle(cx, cy, Math.max(4, H * 0.045), accent, 1);
  return cv.toPNG();
}
