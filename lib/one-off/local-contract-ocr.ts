import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function ocrArchiveJpegPagesLocally(pages: Array<{ bytes: Buffer; fileName: string }>) {
  if (!pages.length) throw new Error("OCR kræver mindst én JPG-side");
  if (process.platform !== "darwin") throw new Error("Engangsimportens lokale JPG-OCR kræver macOS");
  const directory = await mkdtemp(path.join(tmpdir(), "dfks-archive-ocr-"));
  try {
    const paths: string[] = [];
    for (const [index, page] of pages.entries()) {
      const filePath = path.join(directory, `${String(index + 1).padStart(3, "0")}.jpg`);
      await writeFile(filePath, page.bytes, { mode: 0o600 });
      paths.push(filePath);
    }
    const script = path.resolve(process.cwd(), "scripts/one-off/ocr-contract-jpegs.swift");
    const { stdout } = await execFileAsync("xcrun", ["swift", script, ...paths], {
      maxBuffer: 20 * 1024 * 1024,
      timeout: 5 * 60_000,
    });
    const result = JSON.parse(stdout) as Array<{ file: string; text: string }>;
    if (result.length !== pages.length || result.some(page => !page.text.trim())) {
      throw new Error("Lokal OCR kunne ikke læse alle JPG-sider");
    }
    return result.map(page => page.text.trim());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
