import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  computeSpatialAccuracy,
  parsePdftotextBbox,
  processPdfSpatially,
  sha256,
} from "./spatial-ocr.mjs";

const runtimeOnly = { skip: process.env.DFKS_CONTAINER_RUNTIME_TEST !== "1" };

function run(command, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(`${command} failed: ${Buffer.concat(stderr).toString("utf8")}`));
    });
    child.stdin.end(input);
  });
}

async function commandRunner(command, args) {
  const stdout = await run(command, args);
  return { stdout: stdout.toString("utf8"), stderr: "" };
}

test("containeren bevarer sider, rotation og cropbox ved geometrisk overlay", runtimeOnly, async () => {
  const workDir = await mkdtemp(join(tmpdir(), "dfks-runtime-smoke-"));
  try {
    const inputPath = join(workDir, "input.pdf");
    const outputPath = join(workDir, "output.pdf");
    const geometryPath = join(workDir, "geometry.json");
    const generator = `
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
import pikepdf, sys
from PIL import Image
path = sys.argv[1]
image_dir = sys.argv[2]
c = canvas.Canvas(path, pagesize=letter)
for index in range(4):
    c.rect(30, 30, 10, 10, stroke=1, fill=0)
    c.showPage()
c.save()
with pikepdf.open(path, allow_overwriting_input=True) as pdf:
    for index, rotation in enumerate((0, 90, 180, 270)):
        pdf.pages[index].Rotate = rotation
        pdf.pages[index].CropBox = pikepdf.Array([10, 20, 602, 772])
    pdf.save(path)
for index, (width, height) in enumerate(((592, 752), (752, 592), (592, 752), (752, 592)), start=1):
    color = (12, 34, 56) if index == 1 else (255, 255, 255)
    Image.new("RGB", (width, height), color).save(f"{image_dir}/redacted-{index}.jpg", "JPEG", quality=100)
`;
    await run("python3", ["-c", generator, inputPath, workDir]);
    const pdfInfo = (await run("pdfinfo", ["-f", "1", "-l", "4", "-box", inputPath])).toString("utf8");
    const geometry = {
      schemaVersion: "google-vision-spatial-v2",
      engine: "google-vision-document-text-detection",
      pages: [0, 90, 180, 270].map((rotation, index) => {
        const imageWidth = rotation % 180 === 0 ? 592 : 752;
        const imageHeight = rotation % 180 === 0 ? 752 : 592;
        return {
          pageNumber: index + 1,
          imageWidth,
          imageHeight,
          rotation,
          words: [{
            text: `Test${index + 1}`,
            confidence: 0.99,
            vertices: [
              { x: imageWidth * 0.1, y: imageHeight * 0.1 },
              { x: imageWidth * 0.3, y: imageHeight * 0.1 },
              { x: imageWidth * 0.3, y: imageHeight * 0.15 },
              { x: imageWidth * 0.1, y: imageHeight * 0.15 },
            ],
          }],
        };
      }),
    };
    await writeFile(geometryPath, JSON.stringify(geometry));
    await run("python3", ["vision_overlay.py", inputPath, geometryPath, workDir, outputPath]);
    const inspection = await run("python3", ["-c", `
import json, pikepdf, sys
with pikepdf.open(sys.argv[1]) as pdf:
    print(json.dumps({"pages": len(pdf.pages), "rotations": [int(p.get('/Rotate', 0)) for p in pdf.pages], "crops": [[float(v) for v in p.CropBox] for p in pdf.pages]}))
`, outputPath]);
    const result = JSON.parse(inspection.toString("utf8"));
    assert.equal(result.pages, 4);
    assert.deepEqual(result.rotations, [0, 0, 0, 0]);
    assert.deepEqual(result.crops.map(([x0, y0, x1, y1]) => [x1 - x0, y1 - y0]), [
      [592, 752], [752, 592], [592, 752], [752, 592],
    ]);
    const text = (await run("pdftotext", [outputPath, "-"])).toString("utf8");
    for (let index = 1; index <= 4; index += 1) assert.match(text, new RegExp(`Test${index}`));

    const renderedPrefix = join(workDir, "rendered");
    await run("pdftoppm", ["-f", "1", "-singlefile", "-png", "-r", "72", outputPath, renderedPrefix]);
    const visiblePixel = await run("python3", ["-c", `
from PIL import Image
import json, sys
image = Image.open(sys.argv[1]).convert("RGB")
print(json.dumps(image.getpixel((image.width // 2, image.height // 2))))
`, `${renderedPrefix}.png`]);
    const renderedColor = JSON.parse(visiblePixel.toString("utf8"));
    assert.equal(renderedColor.every((value, index) => Math.abs(value - [12, 34, 56][index]) <= 4), true);

    const bboxPath = join(workDir, "bbox.html");
    await run("pdftotext", ["-cropbox", "-bbox-layout", outputPath, bboxPath]);
    const extracted = parsePdftotextBbox(await readFile(bboxPath, "utf8"));
    const spatial = computeSpatialAccuracy(geometry.pages, extracted);
    assert.equal(spatial.measurableWords, 4);
    assert.equal(spatial.passed, true, JSON.stringify({ spatial, extracted, geometry, pdfInfo }));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("blandet PDF genopbygges konsekvent af DLP-sider og bevarer originalen", runtimeOnly, async () => {
  const workDir = await mkdtemp(join(tmpdir(), "dfks-mixed-pdf-"));
  try {
    const inputPath = join(workDir, "input.pdf");
    const outputPath = join(workDir, "output.pdf");
    const geometryPath = join(workDir, "geometry.json.gz");
    await run("python3", ["-c", `
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
import sys
c = canvas.Canvas(sys.argv[1], pagesize=letter)
c.drawString(40, 700, "Dette er en almindelig kontraktside med mere end otte tydelige ord og brugbar tekst til sikker kontrol af blandede PDF dokumenter.")
c.drawString(40, 680, "Den oprindelige digitale tekst skal bevares uden OCR eller andre indholdsmæssige ændringer.")
c.showPage()
c.rect(40, 650, 200, 50, stroke=1, fill=0)
c.showPage()
c.save()
`, inputPath]);
    const original = await readFile(inputPath);
    const googleClient = {
      async redactAndAnnotate(pages) {
        assert.equal(pages.length, 2);
        return {
          redactionCounts: { IBAN_CODE: 1 },
          redactionRegions: [{ pageNumber: 2, top: 1, left: 1, width: 10, height: 10, infoType: "IBAN_CODE" }],
          redactedPages: pages,
          responses: [1, 2].map((pageNumber) => ({
            fullTextAnnotation: { pages: [{
              width: 2550,
              height: 3300,
              blocks: [{ paragraphs: [{ words: Array.from({ length: 10 }, (_, wordIndex) => {
                const value = `KontraktOrd${pageNumber}${wordIndex}Lang`;
                const top = 200 + wordIndex * 220;
                return {
                  confidence: 0.99,
                  boundingBox: { vertices: [
                    { x: 200, y: top }, { x: 800, y: top },
                    { x: 800, y: top + 100 }, { x: 200, y: top + 100 },
                  ] },
                  symbols: value.split("").map((text) => ({ text })),
                };
              }) }] }],
            }] },
          })),
        };
      },
    };
    const result = await processPdfSpatially({
      inputPath, outputPath, geometryPath, workDir, commandRunner, googleClient,
    });
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.nativePageCount, 1);
    assert.equal(result.ocrPageCount, 2);
    assert.deepEqual(result.redactionCounts, { IBAN_CODE: 1 });
    assert.equal(sha256(await readFile(inputPath)), sha256(original));
    const text = (await run("pdftotext", [outputPath, "-"])).toString("utf8");
    assert.match(text, /KontraktOrd10Lang/);
    assert.match(text, /KontraktOrd29Lang/);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("korrupte og krypterede PDF-filer afvises sikkert", runtimeOnly, async () => {
  const workDir = await mkdtemp(join(tmpdir(), "dfks-invalid-pdf-"));
  try {
    const corruptPath = join(workDir, "corrupt.pdf");
    await writeFile(corruptPath, Buffer.from("%PDF-1.7\nnot-a-valid-document"));
    await assert.rejects(() => processPdfSpatially({
      inputPath: corruptPath,
      outputPath: join(workDir, "corrupt-output.pdf"),
      geometryPath: join(workDir, "corrupt-geometry.gz"),
      workDir,
      commandRunner,
      googleClient: { async redactAndAnnotate() { throw new Error("should not run"); } },
    }));

    const plainPath = join(workDir, "plain.pdf");
    const encryptedPath = join(workDir, "encrypted.pdf");
    await run("python3", ["-c", `
from reportlab.pdfgen import canvas
import pikepdf, sys
c = canvas.Canvas(sys.argv[1]); c.drawString(40, 700, "hemmelig"); c.save()
with pikepdf.open(sys.argv[1]) as pdf:
    pdf.save(sys.argv[2], encryption=pikepdf.Encryption(owner="owner", user="user", R=4))
`, plainPath, encryptedPath]);
    await assert.rejects(() => processPdfSpatially({
      inputPath: encryptedPath,
      outputPath: join(workDir, "encrypted-output.pdf"),
      geometryPath: join(workDir, "encrypted-geometry.gz"),
      workDir,
      commandRunner,
      googleClient: { async redactAndAnnotate() { throw new Error("should not run"); } },
    }));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
