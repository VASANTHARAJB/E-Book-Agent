import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LineRuleType,
  LevelFormat,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  TextWrappingType,
  VerticalPositionRelativeFrom,
  WidthType,
} from "docx";
import { bannerArt, coverArt, hashSeed } from "./art.js";
import { imageInfo } from "./images.js";
import { readAsset } from "./store.js";
import { getKit, KIT_IDS } from "./themes.js";

// Page sizes in twips (1 inch = 1440). mx = left/right margin.
const PAGES = {
  "6x9": { w: 8640, h: 12960, mx: 1080, top: 1300, bottom: 1100 },
  A4: { w: 11906, h: 16838, mx: 1440, top: 1440, bottom: 1300 },
  A5: { w: 8391, h: 11906, mx: 1134, top: 1300, bottom: 1100 },
  Letter: { w: 12240, h: 15840, mx: 1440, top: 1440, bottom: 1300 },
  "8x8": { w: 11520, h: 11520, mx: 1080, top: 900, bottom: 900 }, // square, for picture books
};

export const PAGE_SIZES = Object.keys(PAGES);
export { KIT_IDS };

export const DEFAULT_FORMAT = {
  font: null, // null = use the style kit's fonts (Calibri headings, Cambria body)
  bodyPt: 11,
  headingPt: 26,
  subheadingPt: 15,
  lineSpacing: 1.25,
  justify: false,
  pageSize: "6x9",
};

const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

/** Merge a (possibly partial / untrusted) format object with the defaults. */
export function resolveFormat(f = {}) {
  const cleanFont = f.font ? String(f.font).replace(/[^\w .\-&]/g, "").trim().slice(0, 60) : "";
  const bodyPt = clamp(f.bodyPt, 8, 22, DEFAULT_FORMAT.bodyPt);
  return {
    font: cleanFont || null,
    bodyPt,
    headingPt: clamp(f.headingPt, 14, 40, DEFAULT_FORMAT.headingPt),
    subheadingPt: clamp(f.subheadingPt, 9, 24, f.bodyPt ? Math.max(bodyPt, bodyPt + 3) : DEFAULT_FORMAT.subheadingPt),
    lineSpacing: clamp(f.lineSpacing, 1, 2, DEFAULT_FORMAT.lineSpacing),
    justify: f.justify === true,
    pageSize: PAGES[f.pageSize] ? f.pageSize : DEFAULT_FORMAT.pageSize,
  };
}

/** The fonts actually used: the customer's font for everything if they chose one, otherwise the style kit's fonts. */
export function effectiveFonts(draft) {
  const fmt = resolveFormat(draft.format);
  const kit = getKit(draft.kit);
  return { body: fmt.font || kit.bodyFont, head: fmt.font || kit.headFont };
}

const hex = (c, fallback) => (/^#?[0-9a-fA-F]{6}$/.test(String(c || "")) ? String(c).replace("#", "").toUpperCase() : fallback);

function tint(h, amount = 0.9) {
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (v) => Math.round(v + (255 - v) * amount);
  return [mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

// Tiny inline parser: **bold** and *italic*
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0, m;
  const s = String(text ?? "");
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(new TextRun({ text: s.slice(last, m.index), ...base }));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(new TextRun({ text: tok.slice(2, -2), bold: true, ...base }));
    else out.push(new TextRun({ text: tok.slice(1, -1), italics: true, ...base }));
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(new TextRun({ text: s.slice(last), ...base }));
  return out.length ? out : [new TextRun({ text: "", ...base })];
}

const words = (t) => (t ? String(t).trim().split(/\s+/).filter(Boolean).length : 0);

/** Prose words (code blocks are counted separately as lines). */
export function countWords(draft) {
  let n = 0;
  for (const s of draft.sections) {
    for (const b of s.blocks) {
      if (b.type !== "code") n += words(b.text);
      (b.items || []).forEach((t) => (n += words(t)));
      (b.headers || []).forEach((t) => (n += words(t)));
      (b.rows || []).forEach((r) => r.forEach((t) => (n += words(t))));
    }
  }
  return n;
}

export function countCodeLines(draft) {
  let n = 0;
  for (const s of draft.sections) for (const b of s.blocks) if (b.type === "code") n += String(b.text || "").split("\n").length;
  return n;
}

/** Rough layout estimate. Real page count depends on the font; open the file in Word to see it. */
export function estimatePages(draft) {
  const fmt = resolveFormat(draft.format);
  const pg = PAGES[fmt.pageSize];
  const widthPt = (pg.w - pg.mx * 2) / 20;
  const heightPt = (pg.h - pg.top - pg.bottom) / 20;
  const bodyFont = effectiveFonts(draft).body;
  const wideFont = /bookman|verdana|georgia|tahoma|century|palatino/i.test(bodyFont);
  const midFont = /cambria|caladea/i.test(bodyFont);
  const charW = fmt.bodyPt * (wideFont ? 0.46 : midFont ? 0.43 : 0.4); // calibrated against LibreOffice renders; wide fonts are approximate
  const charsPerLine = widthPt / charW;
  const linesPerPage = heightPt / (fmt.bodyPt * 1.2 * fmt.lineSpacing);
  const wordsPerPage = Math.max(120, Math.round(((charsPerLine * linesPerPage) / 6) * 0.75)); // 0.75 covers paragraph gaps, headings and part-filled lines
  const codeLinesPerPage = heightPt / (Math.max(8, fmt.bodyPt - 2) * 1.2);
  const chapters = draft.sections.filter((s) => s.kind === "chapter").length;
  if (draft.kind === "storybook") {
    // one page per scene (a long scene spills onto a second page), plus cover and any front/back pages
    const extra = draft.sections.filter((s) => s.kind === "chapter" && countWords({ sections: [s] }) > 70).length;
    return { pages: 1 + draft.sections.length + extra, wordsPerPage: 60 };
  }
  const others = draft.sections.length - chapters; // front/back sections each start on a new page
  const body = countWords(draft) / wordsPerPage + countCodeLines(draft) / codeLinesPerPage;
  // each chapter: opener (number, title, banner) + a part-filled last page; plus cover and contents. Calibrated against LibreOffice renders (within about 1-2 pages on 26-38 page tests).
  const pages = Math.ceil(body + chapters * (draft.art === false ? 0.9 : 1.15) + others * 0.5 + 2);
  return { pages, wordsPerPage };
}

export function validateBlocks(blocks) {
  const problems = [];
  const types = ["heading", "label", "paragraph", "quote", "callout", "code", "bullets", "numbered", "checklist", "table", "pagebreak", "image"];
  blocks.forEach((b, i) => {
    const at = `blocks[${i}]`;
    if (!types.includes(b.type)) return problems.push(`${at}: unknown type "${b.type}"`);
    if (["heading", "label", "paragraph", "quote", "callout", "code"].includes(b.type) && !String(b.text || "").trim())
      problems.push(`${at} (${b.type}): "text" is required`);
    if (b.type === "image" && !/^[a-z0-9][a-z0-9._-]{0,99}\.(png|jpe?g)$/.test(String(b.file || "")))
      problems.push(`${at} (image): "file" must be the file name returned by generate_image`);
    if (["bullets", "numbered", "checklist"].includes(b.type) && !(Array.isArray(b.items) && b.items.length))
      problems.push(`${at} (${b.type}): "items" must be a non-empty array of strings`);
    if (b.type === "table") {
      if (!(Array.isArray(b.headers) && b.headers.length)) problems.push(`${at} (table): "headers" required`);
      else if (!(Array.isArray(b.rows) && b.rows.length)) problems.push(`${at} (table): "rows" required`);
      else if (b.rows.some((r) => !Array.isArray(r) || r.length !== b.headers.length))
        problems.push(`${at} (table): every row must have exactly ${b.headers.length} cells`);
    }
  });
  return problems;
}

const PX = 96 / 72 / 20; // twips -> CSS pixels (the unit docx uses for image size)

/** Place a stored picture at dispW pixels wide. With targetRatio (height/width) the picture is centre-cropped to that shape. */
function pictureRun(buf, dispW, targetRatio, alt, floating) {
  const info = imageInfo(buf);
  if (!info) throw new Error("Unsupported image file (use PNG or JPEG).");
  const r = info.height / info.width;
  let ratio = r;
  const crop = {};
  if (targetRatio && Math.abs(r - targetRatio) > 0.01) {
    ratio = targetRatio;
    if (r > targetRatio) {
      const cut = ((1 - targetRatio / r) / 2) * 100;
      crop.top = cut;
      crop.bottom = cut;
    } else {
      const cut = ((1 - r / targetRatio) / 2) * 100;
      crop.left = cut;
      crop.right = cut;
    }
  }
  const dispH = Math.max(1, Math.round(dispW * ratio));
  const run = new ImageRun({
    type: info.type,
    data: buf,
    transformation: { width: dispW, height: dispH },
    altText: { name: alt, description: alt, title: alt },
    ...(Object.keys(crop).length ? { crop } : {}),
    ...(floating ? { floating } : {}),
  });
  return { run, height: dispH };
}

export function buildDocument(draft) {
  const fmt = resolveFormat(draft.format);
  const kit = getKit(draft.kit);
  const fonts = effectiveFonts(draft);
  const pg = PAGES[fmt.pageSize];
  const TEXT_W = pg.w - pg.mx * 2;
  const primary = hex(draft.theme?.primary, kit.primary);
  const accent = hex(draft.theme?.accent, kit.accent);
  const artKit = { ...kit, accent };
  if (draft.theme?.primary) {
    // a customer-chosen primary colour: use it for the cover/banner gradient, with a darker bottom
    const n = parseInt(primary, 16);
    artKit.coverTop = primary;
    artKit.coverBottom = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * 0.62).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  const withArt = draft.art !== false;
  const story = draft.kind === "storybook";
  const soft = tint(primary, 0.93);
  const cream = tint(accent, 0.88);
  const bodySize = Math.round(fmt.bodyPt * 2); // half-points
  const small = Math.max(14, bodySize - 6);
  const line = Math.round(fmt.lineSpacing * 240);
  const align = fmt.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT;
  let numberedInstance = 0;

  const body = (text, extra = {}) =>
    new Paragraph({ children: runs(text), alignment: align, spacing: { after: 160, line, lineRule: LineRuleType.AUTO }, ...extra });

  const box = (children, { border = accent, fill = cream, cantSplit = true } = {}) =>
    new Table({
      width: { size: TEXT_W, type: WidthType.DXA },
      columnWidths: [TEXT_W],
      rows: [
        new TableRow({
          cantSplit,
          children: [
            new TableCell({
              width: { size: TEXT_W, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, fill, color: "auto" },
              margins: { top: 140, bottom: 140, left: 220, right: 200 },
              borders: {
                left: { style: BorderStyle.SINGLE, size: 24, color: border },
                top: { style: BorderStyle.NONE, size: 0, color: "auto" },
                bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
                right: { style: BorderStyle.NONE, size: 0, color: "auto" },
              },
              children,
            }),
          ],
        }),
      ],
    });

  const gap = () => new Paragraph({ children: [], spacing: { after: 120 } });

  function renderBlock(b) {
    switch (b.type) {
      case "heading":
        return [new Paragraph({
          heading: (b.level || 2) >= 3 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_2,
          children: [new TextRun({ text: b.text })],
        })];
      case "label":
        return [new Paragraph({
          keepNext: true,
          spacing: { before: 280, after: 100 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: tint(accent, 0.55), space: 3 } },
          children: [new TextRun({ text: String(b.text).toUpperCase(), bold: true, color: accent, size: small, font: fonts.head, characterSpacing: 50 })],
        })];
      case "paragraph":
        return [body(b.text)];
      case "quote": {
        const kids = [new Paragraph({ children: runs(b.text, { italics: true }), spacing: { after: b.attribution ? 80 : 0, line, lineRule: LineRuleType.AUTO } })];
        if (b.attribution) kids.push(new Paragraph({ children: [new TextRun({ text: "— " + String(b.attribution).toUpperCase(), bold: true, size: small, color: accent, font: fonts.head, characterSpacing: 20 })] }));
        return [box(kids), gap()];
      }
      case "callout": {
        const kids = [];
        if (b.title) kids.push(new Paragraph({ children: [new TextRun({ text: String(b.title).toUpperCase(), bold: true, color: accent, size: small, font: fonts.head, characterSpacing: 30 })], spacing: { after: 100 } }));
        kids.push(new Paragraph({ children: runs(b.text), alignment: align, spacing: { line, lineRule: LineRuleType.AUTO } }));
        return [box(kids), gap()];
      }
      case "code": {
        const lines = String(b.text).replace(/\t/g, "    ").replace(/\r/g, "").split("\n");
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        const kids = [];
        if (b.title) kids.push(new Paragraph({ children: [new TextRun({ text: b.title, bold: true, size: Math.max(16, bodySize - 4), color: primary, font: fonts.head })], spacing: { after: 60 } }));
        const codeSize = Math.max(16, bodySize - 4);
        lines.forEach((l) =>
          kids.push(new Paragraph({ children: [new TextRun({ text: l.length ? l : " ", font: "Consolas", size: codeSize })], spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO } })));
        return [box(kids, { border: primary, fill: "F3F4F6", cantSplit: false }), gap()];
      }
      case "bullets":
        return b.items.map((t) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: runs(t), alignment: align, spacing: { after: 80, line, lineRule: LineRuleType.AUTO } }));
      case "numbered": {
        numberedInstance += 1;
        const instance = numberedInstance;
        return b.items.map((t) => new Paragraph({ numbering: { reference: "numbers", level: 0, instance }, children: runs(t), alignment: align, spacing: { after: 80, line, lineRule: LineRuleType.AUTO } }));
      }
      case "checklist":
        return b.items.map((t) => new Paragraph({
          children: [new TextRun({ text: "☐  ", color: accent }), ...runs(t)],
          indent: { left: 360, hanging: 360 },
          spacing: { after: 80, line, lineRule: LineRuleType.AUTO },
        }));
      case "table": {
        const n = b.headers.length;
        const w = Math.floor(TEXT_W / n);
        const widths = Array(n).fill(w);
        widths[n - 1] = TEXT_W - w * (n - 1);
        const ln = { style: BorderStyle.SINGLE, size: 4, color: "D5D9E0" };
        const borders = { top: ln, bottom: ln, left: ln, right: ln };
        const cellSize = Math.max(18, bodySize - 2);
        const cell = (t, i, header, alt) =>
          new TableCell({
            width: { size: widths[i], type: WidthType.DXA },
            borders,
            margins: { top: 90, bottom: 90, left: 130, right: 130 },
            shading: { type: ShadingType.CLEAR, color: "auto", fill: header ? primary : alt ? cream : "FFFFFF" },
            children: [new Paragraph({
              children: runs(t, header
                ? { bold: true, color: "FFFFFF", size: cellSize, font: fonts.head }
                : i === 0 ? { bold: true, color: primary, size: cellSize, font: fonts.head } : { size: cellSize, font: fonts.head }),
            })],
          });
        return [
          new Table({
            width: { size: TEXT_W, type: WidthType.DXA },
            columnWidths: widths,
            rows: [
              new TableRow({ tableHeader: true, children: b.headers.map((h, i) => cell(h, i, true, false)) }),
              ...b.rows.map((r, ri) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false, ri % 2 === 1)) })),
            ],
          }),
          gap(),
        ];
      }
      case "image": {
        const widthPct = Math.min(100, Math.max(30, Number(b.width_pct) || 100));
        const dispW = Math.round(TEXT_W * PX * (widthPct / 100));
        const pic = pictureRun(readAsset(b.file), dispW, null, b.caption || "Illustration");
        const out = [new Paragraph({ alignment: AlignmentType.CENTER, keepNext: !!b.caption, spacing: { before: 120, after: b.caption ? 60 : 200 }, children: [pic.run] })];
        if (b.caption) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 220 }, children: [new TextRun({ text: b.caption, italics: true, size: small, color: "6B7280", font: fonts.head })] }));
        return out;
      }
      case "pagebreak":
        return [new Paragraph({ pageBreakBefore: true, children: [] })];
      default:
        return [];
    }
  }

  const front = draft.sections.filter((s) => s.kind === "front");
  const chapters = draft.sections.filter((s) => s.kind === "chapter");
  const back = draft.sections.filter((s) => s.kind === "back");

  // ---- Cover
  const pageWpx = Math.round(pg.w * PX), pageHpx = Math.round(pg.h * PX);
  const coverSize = Math.round(Math.max(30, Math.min(52, Math.round(2400 / Math.max(14, String(draft.title).length) / 1.2 + 12))) * Math.min(1, pg.h / 12960));
  let coverBuf = null;
  if (draft.coverImage) {
    try { coverBuf = readAsset(draft.coverImage); } catch { coverBuf = null; } // missing file: fall back to the drawn cover
  }
  const darkCover = withArt || !!coverBuf;
  const onDark = darkCover ? "FFFFFF" : primary;
  const pageFloat = (zIndex) => ({
    horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
    verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
    behindDocument: true,
    allowOverlap: true,
    lockAnchor: false,
    wrap: { type: TextWrappingType.NONE },
    zIndex,
  });
  const cover = [];
  let heroPx = 0;
  if (darkCover) {
    // background: full drawn artwork, or just the colour gradient when a picture is placed on top of it
    const png = coverArt(artKit, pageWpx * 2, pageHpx * 2, hashSeed(draft.id || draft.title), { plain: !!coverBuf });
    cover.push(new Paragraph({
      spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
      children: [new ImageRun({
        type: "png",
        data: png,
        transformation: { width: pageWpx, height: pageHpx },
        altText: { name: "Cover background", description: "Decorative cover background", title: "Cover background" },
        floating: pageFloat(1),
      })],
    }));
  }
  if (coverBuf) {
    // picture across the top (about 45% of the page), title block below it so the text always stays readable
    const info = imageInfo(coverBuf);
    const cap = 0.45 * (pageHpx / pageWpx);
    const pic = pictureRun(coverBuf, pageWpx, info ? Math.min(info.height / info.width, cap) : cap, "Cover illustration", pageFloat(2));
    heroPx = pic.height;
    cover.push(new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT }, children: [pic.run] }));
  }
  const coverGap = coverBuf ? Math.max(200, Math.round(heroPx / PX) - pg.top + 360) : Math.round(pg.h * 0.4);
  cover.push(new Paragraph({ spacing: { before: coverGap, after: 0, line: 20, lineRule: LineRuleType.EXACT }, children: [] }));
  if (draft.coverLabel) {
    cover.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: String(draft.coverLabel).toUpperCase(), bold: true, color: accent, size: 18, font: fonts.head, characterSpacing: 80 })],
    }));
  }
  cover.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200, line: 240, lineRule: LineRuleType.AUTO },
    children: [new TextRun({ text: String(draft.title).toUpperCase(), bold: true, size: coverSize * 2 - 8, color: onDark, font: fonts.head })],
  }));
  cover.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    indent: { left: Math.round(TEXT_W * 0.38), right: Math.round(TEXT_W * 0.38) },
    border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: accent, space: 1 } },
    spacing: { after: 280 },
    children: [],
  }));
  if (draft.subtitle) {
    cover.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: draft.subtitle, italics: true, size: 30, color: darkCover ? "E6E9F2" : accent, font: fonts.body })],
    }));
  }
  if (draft.author) {
    cover.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: String(draft.author).toUpperCase(), bold: true, size: 22, color: accent, font: fonts.head, characterSpacing: 40 })],
    }));
  }

  // ---- Section helpers
  const runningHeader = (text) =>
    new Header({
      children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "D5D9E0", space: 4 } },
        children: [new TextRun({ text: String(text).toUpperCase(), size: 15, color: "8A8F99", font: fonts.head, characterSpacing: 20 })],
      })],
    });
  const footer = new Footer({
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "8A8F99", font: fonts.head })] })],
  });
  const pageProps = (extra = {}) => ({
    page: { size: { width: pg.w, height: pg.h }, margin: { top: pg.top, bottom: pg.bottom, left: pg.mx, right: pg.mx }, ...extra },
  });

  const shortRule = () =>
    new Paragraph({
      indent: { right: Math.max(0, TEXT_W - 900) },
      border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: accent, space: 1 } },
      spacing: { before: 60, after: 240 },
      children: [],
    });

  function sectionChildren(s, chapterNo) {
    const kids = [];
    if (s.kind === "chapter") {
      kids.push(new Paragraph({
        spacing: { before: 200, after: 0, line: 240, lineRule: LineRuleType.AUTO },
        children: [new TextRun({ text: String(chapterNo).padStart(2, "0"), bold: true, color: tint(accent, 0.55), size: 150, font: fonts.head })],
      }));
      kids.push(new Paragraph({
        spacing: { after: 120 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: tint(accent, 0.55), space: 4 } },
        children: [new TextRun({ text: String(s.kicker || "Chapter " + chapterNo).toUpperCase(), bold: true, color: accent, size: small, font: fonts.head, characterSpacing: 60 })],
      }));
      kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: s.title })] }));
      if (s.subtitle) {
        kids.push(new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: s.subtitle, italics: true, size: bodySize + 4, color: accent, font: fonts.body })] }));
      }
      kids.push(shortRule());
      let bannerBuf = null;
      if (s.bannerImage) {
        try { bannerBuf = readAsset(s.bannerImage); } catch { bannerBuf = null; }
      }
      if (withArt || bannerBuf) {
        const bw = Math.round(TEXT_W * PX), bh = Math.round(bw * 0.3);
        let run;
        if (bannerBuf) {
          run = pictureRun(bannerBuf, bw, 0.3, "Chapter illustration").run;
        } else {
          const t = chapters.length > 1 ? (chapterNo - 1) / (chapters.length - 1) : 0.5;
          const png = bannerArt(artKit, bw * 2, bh * 2, hashSeed((draft.id || "") + s.title), t);
          run = new ImageRun({
            type: "png",
            data: png,
            transformation: { width: bw, height: bh },
            altText: { name: "Chapter art", description: "Decorative chapter banner", title: "Chapter art" },
          });
        }
        kids.push(new Paragraph({ spacing: { after: 240 }, children: [run] }));
      }
    } else {
      kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: s.title })] }));
      if (s.subtitle) {
        kids.push(new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: s.subtitle, italics: true, size: bodySize + 4, color: accent, font: fonts.body })] }));
      }
      kids.push(shortRule());
    }
    s.blocks.forEach((b) => kids.push(...renderBlock(b)));
    return kids;
  }

  const bodySections = [];
  let first = true;
  const addSection = (header, children) => {
    bodySections.push({
      properties: pageProps(first ? { pageNumbers: { start: 1 } } : {}),
      ...(header === null ? {} : { headers: { default: runningHeader(header) } }),
      footers: { default: footer },
      children: children.length ? children : [new Paragraph({ children: [] })],
    });
    first = false;
  };

  // Picture-book page: one picture on top, a few large sentences below. The scene title is not shown.
  function storyPage(s, no) {
    const kids = [];
    let buf = null;
    if (s.bannerImage) {
      try { buf = readAsset(s.bannerImage); } catch { buf = null; }
    }
    const bw = Math.round(TEXT_W * PX);
    if (buf) {
      const info = imageInfo(buf);
      const pic = pictureRun(buf, bw, info ? Math.min(info.height / info.width, 0.7) : 0.7, s.title);
      kids.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [pic.run] }));
    } else if (withArt) {
      const bh = Math.round(bw * 0.66);
      const t = chapters.length > 1 ? (no - 1) / (chapters.length - 1) : 0.5;
      const png = bannerArt(artKit, bw * 2, bh * 2, hashSeed((draft.id || "") + s.title), t);
      kids.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [new ImageRun({ type: "png", data: png, transformation: { width: bw, height: bh }, altText: { name: "Scene art", description: "Decorative scene artwork", title: "Scene art" } })],
      }));
    }
    s.blocks.forEach((b) => kids.push(...renderBlock(b)));
    return kids;
  }

  if (story) {
    front.forEach((s) => addSection(null, sectionChildren(s)));
    chapters.forEach((s, i) => addSection(null, storyPage(s, i + 1)));
    back.forEach((s) => addSection(null, sectionChildren(s)));
  } else if (chapters.length || front.length || back.length) {
    // Real Word contents list: filled from the Heading 1 paragraphs. Word asks to update it when the file is opened,
    // which fills in the page numbers.
    addSection(draft.title, [
      new Paragraph({ style: "ContentsTitle", children: [new TextRun({ text: "Contents" })] }),
      shortRule(),
      new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-1" }),
    ]);
  }
  if (!story) {
    front.forEach((s) => addSection(s.title, sectionChildren(s)));
    chapters.forEach((s, i) => addSection(s.title, sectionChildren(s, i + 1)));
    back.forEach((s) => addSection(s.title, sectionChildren(s)));
  }
  if (!bodySections.length) addSection(draft.title, []);

  const headStyle = (pt, color, before, after, level, extra = {}) => ({
    run: { font: fonts.head, size: Math.round(pt * 2), bold: true, color },
    paragraph: { spacing: { before, after }, outlineLevel: level, ...extra },
  });

  return new Document({
    creator: draft.author || "Digital Product Studio",
    title: draft.title,
    description: draft.subtitle || "",
    styles: {
      default: { document: { run: { font: fonts.body, size: bodySize } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, ...headStyle(fmt.headingPt, primary, 60, 120, 0, { keepNext: true }) },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, ...headStyle(fmt.subheadingPt, primary, 320, 140, 1, { keepNext: true }) },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, ...headStyle(Math.max(fmt.bodyPt, fmt.subheadingPt - 1), accent, 240, 100, 2, { keepNext: true }) },
        { id: "ContentsTitle", name: "Contents Title", basedOn: "Normal", next: "Normal", ...headStyle(fmt.headingPt, primary, 60, 120, 9) },
        { id: "TOC1", name: "toc 1", basedOn: "Normal", next: "Normal", quickFormat: false, run: { size: bodySize }, paragraph: { spacing: { after: 140 } } },
      ],
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }],
        },
        {
          reference: "numbers",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }],
        },
      ],
    },
    sections: [{ properties: pageProps(), children: cover }, ...bodySections],
  });
}
