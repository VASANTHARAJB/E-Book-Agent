// PDF export: converts the finished .docx with LibreOffice (free), so the PDF always matches the Word design.
// Preferred path: drive LibreOffice through its Python bridge so the contents page gets real page numbers.
// Fallback: plain conversion (contents list without page numbers).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const IS_WIN = process.platform === "win32";

function works(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { timeout: 20000, windowsHide: true });
    return r.status === 0 || (r.stdout && r.stdout.length > 0);
  } catch {
    return false;
  }
}

export function findSoffice() {
  const candidates = [];
  if (process.env.SOFFICE_PATH) candidates.push(process.env.SOFFICE_PATH);
  if (IS_WIN) {
    for (const base of [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"], "C:\\Program Files", "C:\\Program Files (x86)"]) {
      if (base) candidates.push(path.join(base, "LibreOffice", "program", "soffice.exe"));
    }
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/LibreOffice.app/Contents/MacOS/soffice");
  }
  for (const c of candidates) if (fs.existsSync(c)) return c;
  if (!IS_WIN) for (const name of ["soffice", "libreoffice"]) if (works(name, ["--version"])) return name;
  return null;
}

function findPython(soffice) {
  const dir = path.isAbsolute(soffice) ? path.dirname(soffice) : null;
  const list = [];
  if (dir) list.push(path.join(dir, IS_WIN ? "python.exe" : "python"), path.join(dir, "python3"));
  list.push("python3", "python");
  for (const p of list) {
    if (path.isAbsolute(p) && !fs.existsSync(p)) continue;
    if (works(p, ["-c", "import uno"])) return p;
  }
  return null;
}

const UNO_SCRIPT = String.raw`
import sys, time, subprocess, tempfile, shutil, socket
import uno
from com.sun.star.beans import PropertyValue

def pv(n, v):
    p = PropertyValue(); p.Name = n; p.Value = v; return p

soffice, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
profile = tempfile.mkdtemp(prefix="lo_profile_")
proc = subprocess.Popen(
    [soffice, "--headless", "--invisible", "--norestore", "--nologo", "--nodefault",
     "-env:UserInstallation=" + uno.systemPathToFileUrl(profile),
     "--accept=socket,host=127.0.0.1,port=%d;urp;" % port],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
code = 0
try:
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
    ctx = None
    for _ in range(120):
        try:
            ctx = resolver.resolve("uno:socket,host=127.0.0.1,port=%d;urp;StarOffice.ComponentContext" % port)
            break
        except Exception:
            time.sleep(0.5)
    if ctx is None:
        raise RuntimeError("could not connect to LibreOffice")
    desktop = ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
    doc = desktop.loadComponentFromURL(uno.systemPathToFileUrl(src), "_blank", 0, (pv("Hidden", True),))
    for _ in range(2):  # twice: the contents page itself can move the pages
        idx = doc.getDocumentIndexes()
        for i in range(idx.getCount()):
            idx.getByIndex(i).update()
    doc.storeToURL(uno.systemPathToFileUrl(dst), (pv("FilterName", "writer_pdf_Export"),))
    doc.close(True)
    try:
        desktop.terminate()
    except Exception:
        pass
except Exception as e:
    sys.stderr.write("UNO_ERROR: %s\n" % e)
    code = 2
finally:
    try:
        proc.wait(timeout=8)
    except Exception:
        proc.kill()
    shutil.rmtree(profile, ignore_errors=True)
sys.exit(code)
`;

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let err = "";
    child.stderr?.on("data", (d) => (err += d));
    child.stdout?.on("data", () => {});
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      resolve({ code: -1, err: err + "\ntimed out" });
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, err: String(e) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, err });
    });
  });
}

/** Convert docxPath to pdfPath. Resolves { updatedContents: boolean }. Throws a readable error if LibreOffice is missing. */
export async function docxToPdf(docxPath, pdfPath) {
  const soffice = findSoffice();
  if (!soffice) {
    throw new Error(
      "PDF export needs LibreOffice, which is free. Install it from https://www.libreoffice.org/download (Windows/Mac/Linux), then try again. " +
        "If it is installed in an unusual place, set the environment variable SOFFICE_PATH to the full path of soffice(.exe). The Word (.docx) file was built correctly."
    );
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "studio-pdf-"));
  try {
    const src = path.join(work, "book.docx");
    fs.copyFileSync(docxPath, src);

    const py = findPython(soffice);
    if (py) {
      const script = path.join(work, "export.py");
      fs.writeFileSync(script, UNO_SCRIPT);
      const out = path.join(work, "book.pdf");
      const r = await run(py, [script, soffice, src, out], 180000);
      if (r.code === 0 && fs.existsSync(out) && fs.statSync(out).size > 1000) {
        fs.copyFileSync(out, pdfPath);
        return { updatedContents: true };
      }
    }

    // Fallback: plain conversion (contents list without page numbers)
    const outDir = path.join(work, "out");
    fs.mkdirSync(outDir);
    const profile = path.join(work, "profile");
    const url = "file://" + (IS_WIN ? "/" : "") + profile.replace(/\\/g, "/");
    const r2 = await run(soffice, ["--headless", "--norestore", "--nologo", `-env:UserInstallation=${url}`, "--convert-to", "pdf", "--outdir", outDir, src], 180000);
    const made = path.join(outDir, "book.pdf");
    if (!fs.existsSync(made)) throw new Error("LibreOffice could not create the PDF. " + (r2.err || "").slice(0, 300));
    fs.copyFileSync(made, pdfPath);
    return { updatedContents: false };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
