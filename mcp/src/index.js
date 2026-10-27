#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Packer } from "docx";
import { z } from "zod";
import { buildDocument, countCodeLines, countWords, effectiveFonts, estimatePages, KIT_IDS, PAGE_SIZES, resolveFormat, validateBlocks } from "./docbuilder.js";
import { docxToPdf } from "./pdf.js";
import { generateImage, providerStatus } from "./images.js";
import { STYLE_KITS } from "./themes.js";
import { draftsDir, loadDraft, newDocId, outputsDir, safeTextFilename, saveAsset, saveDraft, slugify, storageDir } from "./store.js";

const MAX_SECTIONS = 80;
const MAX_BLOCKS_PER_SECTION = 250;
const MAX_BLOCKS_AFTER_APPEND = 900;
const MAX_TEXT_FILE_BYTES = 1_000_000;
const MAX_IMAGES_PER_DOC = 30;

const ok = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });
const fail = (msg) => ({ isError: true, content: [{ type: "text", text: String(msg) }] });
const guard = (fn) => async (args) => {
  try {
    return await fn(args);
  } catch (e) {
    return fail(e?.message || e);
  }
};

const blockSchema = z.object({
  type: z.enum(["heading", "label", "paragraph", "quote", "callout", "code", "bullets", "numbered", "checklist", "table", "pagebreak", "image"]),
  text: z.string().max(12000).optional().describe("Text for heading / label / paragraph / quote / callout / code. A label is a short small-caps line such as 'The Story' or 'The Framework' that starts a part of a chapter. Inline **bold** and *italic* work (not in code)."),
  level: z.number().int().min(2).max(3).optional().describe("Heading level: 2 (section / subtopic) or 3 (sub-section)."),
  attribution: z.string().max(300).optional().describe("Quote attribution (only for real, verifiable sources)."),
  title: z.string().max(200).optional().describe("Callout title, or caption above a code block (e.g. 'Example 3.1: loops.py')."),
  items: z.array(z.string().max(2000)).max(60).optional().describe("Items for bullets / numbered / checklist."),
  headers: z.array(z.string().max(200)).max(8).optional().describe("Table header cells."),
  rows: z.array(z.array(z.string().max(1000)).max(8)).max(60).optional().describe("Table rows; each row must have the same number of cells as headers."),
  file: z.string().max(100).optional().describe("Image block: the file name returned by generate_image (purpose 'figure')."),
  caption: z.string().max(300).optional().describe("Image block: caption shown under the picture."),
  width_pct: z.number().min(30).max(100).optional().describe("Image block: width as a percentage of the text width. Default 100."),
});

const summary = (d) => {
  const est = estimatePages(d);
  return {
    docId: d.id,
    title: d.title,
    sections: d.sections.length,
    chapters: d.sections.filter((s) => s.kind === "chapter").length,
    proseWords: countWords(d),
    codeLines: countCodeLines(d),
    estimatedPages: est.pages,
    assumedWordsPerPage: est.wordsPerPage,
  };
};

const server = new McpServer({ name: "product-studio", version: "1.2.0" });

server.registerTool(
  "doc_start",
  {
    title: "Start a document",
    description:
      "Start a new editable Word (.docx) document draft (ebook, textbook, playbook, strategy doc...). Returns a docId. " +
      "Pass the customer's formatting requests here (font, sizes, line spacing, justify, page size) and pick a style_kit (palette, fonts, code-drawn cover and chapter art). " +
      "Then call doc_add_section once per chapter/section (use append for long chapters), and finally doc_build.",
    inputSchema: {
      title: z.string().min(1).max(200),
      subtitle: z.string().max(300).optional(),
      author: z.string().max(200).optional(),
      primary_color: z.string().optional().describe("Theme primary color as 6-digit hex, e.g. 1F3A5F"),
      accent_color: z.string().optional().describe("Theme accent color as 6-digit hex, e.g. E07A1F"),
      kind: z.enum(["book", "document", "storybook"]).optional().describe("'storybook' = an illustrated picture book: square pages, one picture and a few large sentences per scene (each scene is a chapter section), no contents page. Default 'book'."),
      character_sheet: z.string().max(2000).optional().describe("Storybook: fixed written description of every recurring character (age, hair, skin, clothes, colours, size). It is added to EVERY picture request so characters look the same on every page."),
      art_style: z.string().max(400).optional().describe("Storybook/pictures: one fixed style sentence added to every picture request, e.g. 'soft watercolour picture-book illustration, warm colours, gentle light'."),
      style_kit: z.enum(KIT_IDS).optional().describe("Design family: " + KIT_IDS.map((k) => `${k} = ${STYLE_KITS[k].label}`).join("; ") + ". Default focus-navy."),
      cover_label: z.string().max(60).optional().describe("Small line above the title on the cover, e.g. 'A SELF-HELP GUIDE'."),
      art: z.boolean().optional().describe("Draw the cover and a banner at the start of each chapter. Default true. Set false for a plain, text-only document."),
      font: z.string().max(60).optional().describe("Only set this if the customer asks for a specific font: it is then used for the whole document, e.g. 'Bookman Old Style', 'Times New Roman'. Default: the style kit's fonts (Calibri headings, Cambria body)."),
      body_size_pt: z.number().min(8).max(16).optional().describe("Body text size in points. Default 11."),
      chapter_heading_size_pt: z.number().min(14).max(40).optional().describe("Chapter title size in points. Default 26."),
      subheading_size_pt: z.number().min(9).max(24).optional().describe("Size of section/subtopic headings in points (level-2 headings). Default 15, or body size + 3 if you set body size."),
      line_spacing: z.number().min(1).max(2).optional().describe("Line spacing multiple, e.g. 1.15. Default 1.25."),
      justify: z.boolean().optional().describe("Justify body text. Default false."),
      page_size: z.enum(PAGE_SIZES).optional().describe("Page size: A4, A5, Letter, 6x9 (default) or 8x8 (square, default for storybooks)."),
    },
  },
  guard(async (a) => {
    const id = newDocId();
    const story = a.kind === "storybook";
    const format = resolveFormat({
      font: a.font,
      bodyPt: a.body_size_pt ?? (story ? 18 : undefined),
      headingPt: a.chapter_heading_size_pt,
      subheadingPt: a.subheading_size_pt,
      lineSpacing: a.line_spacing ?? (story ? 1.4 : undefined),
      justify: a.justify,
      pageSize: a.page_size ?? (story ? "8x8" : undefined),
    });
    const draft = {
      id,
      kind: a.kind || "book",
      title: a.title,
      subtitle: a.subtitle || "",
      author: a.author || "",
      theme: { primary: a.primary_color, accent: a.accent_color },
      kit: a.style_kit || (story ? "story-sunrise" : "focus-navy"),
      characterSheet: a.character_sheet || "",
      artStyle: a.art_style || "",
      coverLabel: a.cover_label || "",
      art: a.art !== false,
      format,
      sections: [],
      createdAt: new Date().toISOString(),
    };
    saveDraft(draft);
    return ok({ docId: id, styleKit: draft.kit, art: draft.art, appliedFormat: format, fonts: effectiveFonts(draft), next: "Call doc_add_section for each section, then doc_build." });
  })
);

server.registerTool(
  "doc_add_section",
  {
    title: "Add, replace or extend a section",
    description:
      "Add a section to a draft. kind='front' (preface, how to read), 'chapter' (numbered automatically in the order added), " +
      "or 'back' (appendix, exercises, about). If a section with the same kind and title already exists it is REPLACED, " +
      "unless append=true, in which case the blocks are ADDED to the end of that section. Use append=true to write a long chapter " +
      "in several calls (first call creates it, later calls append). Write full prose in 'paragraph' blocks; use 'heading' (level 2) for subtopics, " +
      "'code' for program code, and tables/checklists/callouts where useful.",
    inputSchema: {
      docId: z.string(),
      kind: z.enum(["front", "chapter", "back"]),
      title: z.string().min(1).max(200),
      subtitle: z.string().max(300).optional(),
      kicker: z.string().max(60).optional().describe("Chapters only: the part or theme label shown in small capitals above the chapter title, e.g. 'Pain & Awakening'."),
      append: z.boolean().optional().describe("true = add these blocks to the end of the existing section with the same kind and title."),
      blocks: z.array(blockSchema).min(1).max(MAX_BLOCKS_PER_SECTION),
    },
  },
  guard(async ({ docId, kind, title, subtitle, kicker, append, blocks }) => {
    const draft = loadDraft(docId);
    const problems = validateBlocks(blocks);
    if (problems.length) return fail("Section not saved. Fix these and call again:\n- " + problems.slice(0, 15).join("\n- "));
    const clean = blocks.map((b) => {
      const o = { type: b.type };
      for (const k of ["text", "level", "attribution", "title", "items", "headers", "rows", "file", "caption", "width_pct"]) if (b[k] !== undefined) o[k] = b[k];
      return o;
    });
    const idx = draft.sections.findIndex((s) => s.kind === kind && s.title === title);
    let replaced = false, appended = false;
    if (idx >= 0 && append) {
      const merged = draft.sections[idx].blocks.concat(clean);
      if (merged.length > MAX_BLOCKS_AFTER_APPEND) return fail(`Section too long (max ${MAX_BLOCKS_AFTER_APPEND} blocks). Split it into two chapters.`);
      draft.sections[idx].blocks = merged;
      if (subtitle) draft.sections[idx].subtitle = subtitle;
      if (kicker) draft.sections[idx].kicker = kicker;
      appended = true;
    } else if (idx >= 0) {
      draft.sections[idx] = { kind, title, subtitle: subtitle || "", kicker: kicker || "", bannerImage: draft.sections[idx].bannerImage, blocks: clean };
      replaced = true;
    } else {
      if (draft.sections.length >= MAX_SECTIONS) return fail(`Too many sections (max ${MAX_SECTIONS}).`);
      draft.sections.push({ kind, title, subtitle: subtitle || "", kicker: kicker || "", blocks: clean });
    }
    saveDraft(draft);
    const sec = draft.sections.find((s) => s.kind === kind && s.title === title);
    return ok({
      saved: true,
      replaced,
      appended,
      section: title,
      kind,
      sectionWords: countWords({ sections: [sec] }),
      ...summary(draft),
    });
  })
);

server.registerTool(
  "doc_status",
  {
    title: "Draft status",
    description:
      "List the sections, word counts and estimated page count of a draft. Use it to check progress against a page target before doc_build. " +
      "The page estimate is approximate (depends on the real font); tell the customer to check the real count in Word.",
    inputSchema: { docId: z.string() },
  },
  guard(async ({ docId }) => {
    const d = loadDraft(docId);
    return ok({
      ...summary(d),
      format: resolveFormat(d.format),
      sectionList: d.sections.map((s) => ({ kind: s.kind, title: s.title, words: countWords({ sections: [s] }), codeLines: countCodeLines({ sections: [s] }) })),
    });
  })
);

server.registerTool(
  "doc_list",
  {
    title: "List existing drafts",
    description: "List the most recent drafts (docId, title, size). Use this to resume work after a new chat starts and the docId is no longer known.",
    inputSchema: {},
  },
  guard(async () => {
    const files = fs.readdirSync(draftsDir()).filter((f) => /^d_[a-f0-9]{12}\.json$/.test(f));
    const drafts = files
      .map((f) => {
        try { return loadDraft(f.replace(/\.json$/, "")); } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 20)
      .map((d) => ({ ...summary(d), createdAt: d.createdAt }));
    return ok({ drafts });
  })
);

server.registerTool(
  "image_status",
  {
    title: "Check image providers",
    description:
      "Check which AI image providers (OpenAI, Gemini) are set up, and which image model each will use. Call this once before generating pictures. " +
      "It never shows the keys. If no provider is set up, tell the customer plainly and continue with the built-in drawn artwork.",
    inputSchema: {},
  },
  guard(async () => ok({ providers: await providerStatus(), maxImagesPerDocument: MAX_IMAGES_PER_DOC }))
);

server.registerTool(
  "generate_image",
  {
    title: "Generate a picture with AI",
    description:
      "Generate ONE picture with an AI image model (OpenAI or Gemini) and attach it to the document. Costs money per image, so only call it when the customer wants AI pictures, and tell them how many you will make first. " +
      "purpose='cover': a picture across the top of the cover (landscape). purpose='chapter': the banner at the start of an existing chapter, or in a storybook the picture for that scene (give chapter_title exactly as added). Calling it again for the same chapter replaces the picture, which is how you redo one. " +
      "purpose='figure': a picture you then place yourself with an 'image' block using the returned file name. " +
      "Describe the scene only; never ask for text, letters or logos inside the picture (they come out wrong). Avoid real people, brands and copyrighted characters.",
    inputSchema: {
      docId: z.string(),
      purpose: z.enum(["cover", "chapter", "figure"]),
      prompt: z.string().min(10).max(1500).describe("What the picture shows: subject, setting, mood, style, colours. No text in the image."),
      chapter_title: z.string().max(200).optional().describe("Required for purpose 'chapter': the title of the chapter section."),
      provider: z.enum(["auto", "openai", "gemini"]).optional().describe("Default auto: OpenAI first if configured, otherwise Gemini, and the other one if the first fails."),
      quality: z.enum(["low", "medium", "high"]).optional().describe("OpenAI quality. Default medium. Higher costs more."),
    },
  },
  guard(async ({ docId, purpose, prompt, chapter_title, provider, quality }) => {
    const draft = loadDraft(docId);
    draft.images = draft.images || [];
    if (draft.images.length >= MAX_IMAGES_PER_DOC) return fail(`Image limit reached (${MAX_IMAGES_PER_DOC} per document).`);
    let section = null;
    if (purpose === "chapter") {
      if (!chapter_title) return fail("chapter_title is required for purpose 'chapter'.");
      section = draft.sections.find((s) => s.kind === "chapter" && s.title === chapter_title);
      if (!section) return fail(`No chapter titled "${chapter_title}". Add the chapter with doc_add_section first, and use its exact title.`);
    }
    const shape = purpose === "chapter" && draft.kind !== "storybook" ? "banner" : "landscape";
    // keep characters and style identical across pictures by adding the fixed character sheet and style to every request
    const fullPrompt = [
      draft.artStyle ? `Art style: ${draft.artStyle}.` : "",
      draft.characterSheet ? `Recurring characters, draw them exactly like this in every picture: ${draft.characterSheet}.` : "",
      `Scene: ${prompt}`,
    ].filter(Boolean).join(" ");
    const r = await generateImage({ prompt: fullPrompt, shape, quality: quality || "medium", provider: provider || "auto" });
    const stem = purpose === "chapter" ? slugify(chapter_title).slice(0, 30) : purpose;
    const file = `${docId}-${stem}-${crypto.randomBytes(3).toString("hex")}.${r.type}`;
    saveAsset(file, r.buffer);
    let assigned = "not placed yet: add an 'image' block with this file";
    if (purpose === "cover") {
      draft.coverImage = file;
      assigned = "cover picture";
    } else if (purpose === "chapter") {
      section.bannerImage = file;
      assigned = draft.kind === "storybook" ? `picture for "${chapter_title}"` : `banner of chapter "${chapter_title}"`;
    }
    draft.images.push({ file, purpose, provider: r.provider, model: r.model });
    saveDraft(draft);
    return ok({
      generated: true,
      file,
      assigned,
      provider: r.provider,
      model: r.model,
      width: r.width,
      height: r.height,
      bytes: r.buffer.length,
      imagesInDocument: draft.images.length,
      ...(r.fellBackFrom ? { note: `${r.fellBackFrom} failed (${String(r.firstError).slice(0, 160)}), so the other provider was used.` } : {}),
      reminder: "AI pictures can contain mistakes. Tell the customer to look at them before publishing.",
    });
  })
);

server.registerTool(
  "doc_build",
  {
    title: "Build the Word and PDF files",
    description:
      "Render the draft to an editable Word .docx (cover, contents, styled chapter openers, tables, code blocks, callouts, page numbers) " +
      "and, by default, also a PDF made from the same file, using the formatting and style kit chosen in doc_start. " +
      "Returns the file names the user can download. Safe to call again after revisions. " +
      "If the PDF cannot be made (LibreOffice missing) the Word file is still built and the PDF problem is reported in pdf.error.",
    inputSchema: {
      docId: z.string(),
      filename: z.string().max(80).optional().describe("Optional base name, without extension"),
      formats: z.enum(["both", "docx", "pdf"]).optional().describe("Which files to produce. Default both."),
    },
  },
  guard(async ({ docId, filename, formats }) => {
    const draft = loadDraft(docId);
    if (!draft.sections.length) return fail("Draft has no sections. Add sections with doc_add_section first.");
    const want = formats || "both";
    const base = slugify(filename || draft.title);
    const docxFile = base + ".docx";
    const docxPath = path.join(outputsDir(), docxFile);
    const buf = await Packer.toBuffer(buildDocument(draft));
    fs.writeFileSync(docxPath, buf);
    const out = { built: true, ...summary(draft), note: "estimatedPages is approximate; open the file in Word for the real page count." };
    if (want !== "pdf") Object.assign(out, { file: docxFile, bytes: buf.length });
    if (want !== "docx") {
      try {
        const pdfFile = base + ".pdf";
        const r = await docxToPdf(docxPath, path.join(outputsDir(), pdfFile));
        out.pdf = { file: pdfFile, bytes: fs.statSync(path.join(outputsDir(), pdfFile)).size, contentsHavePageNumbers: r.updatedContents };
      } catch (e) {
        out.pdf = { error: String(e?.message || e) };
      }
    }
    if (want === "pdf" && out.pdf?.file) fs.rmSync(docxPath, { force: true });
    return ok(out);
  })
);

server.registerTool(
  "save_file",
  {
    title: "Save a text file",
    description:
      "Save a plain text deliverable (e.g. landing page .html, copy in .md, ad sheet in .csv) for the user to download. " +
      "Allowed extensions: .html .md .txt .json .csv. Max 1 MB.",
    inputSchema: { filename: z.string().min(1).max(100), content: z.string().min(1) },
  },
  guard(async ({ filename, content }) => {
    if (Buffer.byteLength(content, "utf8") > MAX_TEXT_FILE_BYTES) return fail("File too large (max 1 MB).");
    const file = safeTextFilename(filename);
    fs.writeFileSync(path.join(outputsDir(), file), content, "utf8");
    return ok({ saved: true, file, bytes: Buffer.byteLength(content, "utf8") });
  })
);

storageDir(); // create folders eagerly
const transport = new StdioServerTransport();
await server.connect(transport);
// Never write to stdout from here on: stdout is the MCP protocol channel.
console.error("[product-studio-mcp] ready, storage:", storageDir());
