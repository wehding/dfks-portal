import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import {
  computeSpatialAccuracy,
  parsePdfPageSize,
  parsePdftotextBbox,
  processPdfSpatially,
  renderedPixelCount,
  sha256,
} from "./spatial-ocr.mjs";

const runtimeOnly = { skip: process.env.DFKS_CONTAINER_RUNTIME_TEST !== "1" };

function identityVisionPageTransforms(pages, width = 2550, height = 3300) {
  return pages.map((page) => ({
    pageNumber: page.pageNumber,
    sourceWidth: width,
    sourceHeight: height,
    visionWidth: width,
    visionHeight: height,
  }));
}

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
    Image.new("RGB", (width, height), color).save(f"{image_dir}/redacted-{index}.png", "PNG")
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

test("stor verificeret PNG bliver en afledt PDF under bytegrænsen uden at ændre originalen", runtimeOnly, async () => {
  const workDir = await mkdtemp(join(tmpdir(), "dfks-derived-compression-"));
  try {
    const inputPath = join(workDir, "input.pdf");
    const outputPath = join(workDir, "output.pdf");
    const geometryPath = join(workDir, "geometry.json");
    await run("python3", ["-c", `
from PIL import Image
from reportlab.pdfgen import canvas
import sys
input_path, image_dir = sys.argv[1:]
c = canvas.Canvas(input_path, pagesize=(612, 792))
c.showPage()
c.save()
# Deterministic high-entropy raster: lossless PNG is large, while the bounded
# derivative JPEG remains readable and substantially smaller.
image = Image.effect_noise((1400, 1800), 70).convert("RGB")
image.save(f"{image_dir}/redacted-1.png", "PNG")
`, inputPath, workDir]);
    await writeFile(geometryPath, JSON.stringify({
      pages: [{
        pageNumber: 1,
        imageWidth: 1400,
        imageHeight: 1800,
        words: [{
          text: "SikkerKontrakt",
          vertices: [
            { x: 100, y: 100 }, { x: 400, y: 100 },
            { x: 400, y: 150 }, { x: 100, y: 150 },
          ],
        }],
      }],
    }));
    const originalHash = sha256(await readFile(inputPath));
    const byteLimit = 2_000_000;
    await run("python3", [
      "vision_overlay.py", inputPath, geometryPath, workDir, outputPath, String(byteLimit),
    ]);
    const output = await readFile(outputPath);
    assert.ok(output.length <= byteLimit, `afledt PDF er ${output.length} bytes`);
    assert.equal(sha256(await readFile(inputPath)), originalHash);
    assert.match((await run("pdftotext", [outputPath, "-"])).toString("utf8"), /SikkerKontrakt/);
    const usesBoundedDerivative = (await run("python3", ["-c", `
import pikepdf, sys
with pikepdf.open(sys.argv[1]) as pdf:
    filters = []
    for _, value in pdf.pages[0].Resources.XObject.items():
        current = value.get('/Filter')
        filters.extend(str(item) for item in current) if isinstance(current, pikepdf.Array) else filters.append(str(current))
    print('/DCTDecode' in filters)
`, outputPath])).toString("utf8").trim();
    assert.equal(usesBoundedDerivative, "True");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("fysiske 90/180/270-rettelser bevarer CropBox-rækkefølge og geometri", runtimeOnly, async () => {
  const workDir = await mkdtemp(join(tmpdir(), "dfks-physical-rotation-"));
  try {
    const inputPath = join(workDir, "input.pdf");
    const outputPath = join(workDir, "output.pdf");
    const geometryPath = join(workDir, "geometry.json");
    await run("python3", ["-c", `
from reportlab.pdfgen import canvas
import pikepdf, sys
from PIL import Image, ImageDraw
path, image_dir = sys.argv[1:]
c = canvas.Canvas(path, pagesize=(620, 820))
for page in range(3):
    c.drawString(20, 20, f"source-{page + 1}")
    c.showPage()
c.save()
with pikepdf.open(path, allow_overwriting_input=True) as pdf:
    for index, crop in enumerate(((10, 20, 510, 720), (20, 30, 530, 740), (30, 40, 550, 760))):
        pdf.pages[index].CropBox = pikepdf.Array(crop)
    pdf.save(path)
for index in range(1, 4):
    image = Image.new("RGB", (100, 150), (240, 240, 240))
    ImageDraw.Draw(image).rectangle((10 * index, 10, 10 * index + 5, 20), fill=(10, 20, 30))
    image.save(f"{image_dir}/source-{index}.jpg", "JPEG", quality=100)
`, inputPath, workDir]);

    const corrections = [270, 180, 90];
    for (let page = 1; page <= 3; page += 1) {
      await run("python3", [
        "normalise_orientation.py",
        join(workDir, `source-${page}.jpg`),
        join(workDir, `redacted-${page}.png`),
        String(corrections[page - 1]),
      ]);
    }
    const geometry = {
      pages: corrections.map((correction, index) => ({
        pageNumber: index + 1,
        imageWidth: correction % 180 === 0 ? 100 : 150,
        imageHeight: correction % 180 === 0 ? 150 : 100,
        orientationCorrection: correction,
        words: [{
          text: `RettetSide${index + 1}`,
          vertices: [
            { x: 10, y: 10 }, { x: 80, y: 10 },
            { x: 80, y: 25 }, { x: 10, y: 25 },
          ],
        }],
      })),
    };
    await writeFile(geometryPath, JSON.stringify(geometry));
    await run("python3", ["vision_overlay.py", inputPath, geometryPath, workDir, outputPath]);
    const inspection = JSON.parse((await run("python3", ["-c", `
import json, pikepdf, sys
with pikepdf.open(sys.argv[1]) as pdf:
    print(json.dumps([[float(p.MediaBox[2]), float(p.MediaBox[3])] for p in pdf.pages]))
`, outputPath])).toString("utf8"));
    assert.deepEqual(inspection, [[700, 500], [510, 710], [720, 520]]);
    const text = (await run("pdftotext", [outputPath, "-"])).toString("utf8");
    assert.ok(text.indexOf("RettetSide1") < text.indexOf("RettetSide2"));
    assert.ok(text.indexOf("RettetSide2") < text.indexOf("RettetSide3"));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("helsides raster med skjult tekstlag springer ikke DLP og Vision over", runtimeOnly, async () => {
  const workDir = await mkdtemp(join(tmpdir(), "dfks-hidden-text-scan-"));
  try {
    const inputPath = join(workDir, "input.pdf");
    await run("python3", ["-c", `
from PIL import Image, ImageDraw
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
import sys
image = Image.new("RGB", (2550, 3300), "white")
ImageDraw.Draw(image).text((100, 100), "SCANNET KONTRAKT", fill="black")
c = canvas.Canvas(sys.argv[1], pagesize=(612, 792))
c.drawImage(ImageReader(image), 0, 0, width=612, height=792)
text = c.beginText(20, 760)
text.setTextRenderMode(3)
for row in range(10):
    text.textLine(" ".join(f"skjultkontraktord{row}_{word}" for word in range(15)))
c.drawText(text)
c.showPage()
c.save()
`, inputPath]);
    let googleCalled = false;
    const result = await processPdfSpatially({
      inputPath,
      outputPath: join(workDir, "output.pdf"),
      geometryPath: join(workDir, "geometry.json.gz"),
      workDir,
      commandRunner,
      googleClient: {
        async redactAndAnnotate(pages) {
          googleCalled = true;
          return {
            responses: [{ fullTextAnnotation: { pages: [] } }],
            redactionCounts: {}, redactionRegions: [], redactedPages: pages,
            visionPageTransforms: identityVisionPageTransforms(pages),
          };
        },
      },
    });
    assert.equal(googleCalled, true);
    assert.equal(result.status, "needs_review");
    assert.notEqual(result.classification, "native_text");
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
          visionPageTransforms: identityVisionPageTransforms(pages),
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
    assert.equal(result.ocrPageCount, 1);
    assert.equal(result.nativePageCount + result.ocrPageCount, result.pageCount);
    assert.deepEqual(result.redactionCounts, { IBAN_CODE: 1 });
    const persistedGeometry = JSON.parse(gunzipSync(await readFile(geometryPath)).toString("utf8"));
    assert.deepEqual(persistedGeometry.spatialVerification, result.spatial);
    assert.equal(persistedGeometry.spatialVerification.matchCoverage, 1);
    assert.equal(persistedGeometry.spatialVerification.passed, true);
    assert.equal(sha256(await readFile(inputPath)), sha256(original));
    const text = (await run("pdftotext", [outputPath, "-"])).toString("utf8");
    assert.match(text, /KontraktOrd10Lang/);
    assert.match(text, /KontraktOrd29Lang/);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("for stor DLP-side genrenderes adaptivt før Google-kald", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "dfks-dlp-resize-"));
  try {
    const renderArgs = [];
    const adaptiveRunner = async (command, args) => {
      if (command === "pdfinfo") return { stdout: "Pages: 1\nPage    1 size: 612 x 792 pts\n", stderr: "" };
      if (command === "pdftotext") {
        await writeFile(args.at(-1), "");
        return { stdout: "", stderr: "" };
      }
      if (command === "pdftoppm") {
        renderArgs.push(args);
        const bytes = renderArgs.length === 1 ? 3_000_000 : 2_000_000;
        await writeFile(`${args.at(-1)}.jpg`, Buffer.alloc(bytes, 0xff));
        return { stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command: ${command}`);
    };
    const result = await processPdfSpatially({
      inputPath: join(workDir, "input.pdf"),
      outputPath: join(workDir, "output.pdf"),
      geometryPath: join(workDir, "geometry.json.gz"),
      workDir,
      commandRunner: adaptiveRunner,
      googleClient: {
        async redactAndAnnotate(pages) {
          assert.equal(pages.length, 1);
          assert.equal(pages[0].imageBytes.length, 2_000_000);
          return {
            responses: [{ fullTextAnnotation: { pages: [] } }],
            redactionCounts: {}, redactionRegions: [], redactedPages: pages,
            visionPageTransforms: identityVisionPageTransforms(pages),
          };
        },
      },
    });
    assert.equal(renderArgs.length, 2);
    assert.equal(renderArgs[0].includes("300"), true);
    assert.equal(renderArgs[1].includes("275"), true);
    assert.equal(result.status, "needs_review");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("alle for store DLP-profiler stopper før Google-kald", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "dfks-dlp-reject-"));
  try {
    let renderCount = 0;
    let googleCalled = false;
    const oversizedRunner = async (command, args) => {
      if (command === "pdfinfo") return { stdout: "Pages: 1\nPage    1 size: 612 x 792 pts\n", stderr: "" };
      if (command === "pdftotext") {
        await writeFile(args.at(-1), "");
        return { stdout: "", stderr: "" };
      }
      if (command === "pdftoppm") {
        renderCount += 1;
        await writeFile(`${args.at(-1)}.jpg`, Buffer.alloc(2_900_001, 0xff));
        return { stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command: ${command}`);
    };
    await assert.rejects(() => processPdfSpatially({
      inputPath: join(workDir, "input.pdf"),
      outputPath: join(workDir, "output.pdf"),
      geometryPath: join(workDir, "geometry.json.gz"),
      workDir,
      commandRunner: oversizedRunner,
      googleClient: { async redactAndAnnotate() { googleCalled = true; } },
    }), /dlp_request_too_large/);
    assert.equal(renderCount, 5);
    assert.equal(googleCalled, false);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("PDF-sidestørrelse giver et afgrænset pixelbudget", () => {
  const size = parsePdfPageSize("Page    1 size: 612 x 792 pts (letter)\n");
  assert.deepEqual(size, { widthPoints: 612, heightPoints: 792 });
  assert.equal(renderedPixelCount(size, 300), 2550 * 3300);
  assert.equal(parsePdfPageSize("Page size: invalid"), null);
});

test("ekstrem sidestørrelse afvises før rendering og Google", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "dfks-pixel-cap-"));
  try {
    let rendered = false;
    let googleCalled = false;
    const cappedRunner = async (command, args) => {
      if (command === "pdfinfo") return { stdout: "Pages: 1\nPage    1 size: 20000 x 20000 pts\n", stderr: "" };
      if (command === "pdftotext") {
        await writeFile(args.at(-1), "");
        return { stdout: "", stderr: "" };
      }
      if (command === "pdftoppm") rendered = true;
      throw new Error(`unexpected command: ${command}`);
    };
    await assert.rejects(() => processPdfSpatially({
      inputPath: join(workDir, "input.pdf"),
      outputPath: join(workDir, "output.pdf"),
      geometryPath: join(workDir, "geometry.json.gz"),
      workDir,
      commandRunner: cappedRunner,
      googleClient: { async redactAndAnnotate() { googleCalled = true; } },
    }), /dlp_request_too_large/);
    assert.equal(rendered, false);
    assert.equal(googleCalled, false);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("dokumentets sidegrænse afvises før sideudtræk, rendering og Google", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "dfks-page-limit-"));
  try {
    let pageCommandCalled = false;
    let googleCalled = false;
    const cappedRunner = async (command) => {
      if (command === "pdfinfo") return { stdout: "Pages: 4\n", stderr: "" };
      pageCommandCalled = true;
      throw new Error(`unexpected command: ${command}`);
    };
    await assert.rejects(() => processPdfSpatially({
      inputPath: join(workDir, "input.pdf"),
      outputPath: join(workDir, "output.pdf"),
      geometryPath: join(workDir, "geometry.json.gz"),
      workDir,
      commandRunner: cappedRunner,
      googleClient: { async redactAndAnnotate() { googleCalled = true; } },
      resourceLimits: { maxDocumentPages: 3 },
    }), /document_page_limit_exceeded/);
    assert.equal(pageCommandCalled, false);
    assert.equal(googleCalled, false);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("samlet rasterbudget stopper en flersidet PDF før alle sidebuffere samles", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "dfks-raster-limit-"));
  try {
    let renderCount = 0;
    let googleCalled = false;
    const budgetRunner = async (command, args) => {
      if (command === "pdfinfo" && !args.includes("-box")) {
        return { stdout: "Pages: 4\n", stderr: "" };
      }
      if (command === "pdfinfo") {
        return { stdout: "Pages: 1\nPage    1 size: 612 x 792 pts\n", stderr: "" };
      }
      if (command === "pdftotext") {
        await writeFile(args.at(-1), "");
        return { stdout: "", stderr: "" };
      }
      if (command === "pdftoppm") {
        renderCount += 1;
        await writeFile(`${args.at(-1)}.jpg`, Buffer.alloc(800, 0xff));
        return { stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command: ${command}`);
    };
    await assert.rejects(() => processPdfSpatially({
      inputPath: join(workDir, "input.pdf"),
      outputPath: join(workDir, "output.pdf"),
      geometryPath: join(workDir, "geometry.json.gz"),
      workDir,
      commandRunner: budgetRunner,
      googleClient: { async redactAndAnnotate() { googleCalled = true; } },
      resourceLimits: { maxDocumentPages: 4, maxDocumentRasterBytes: 2_000 },
    }), /document_raster_budget_exceeded/);
    assert.equal(renderCount, 3);
    assert.equal(googleCalled, false);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("en flersidet PDF på rasterbudgettets stramme testgrænse bevarer OCR-flowet", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "dfks-raster-boundary-"));
  try {
    let googlePages = 0;
    const boundaryRunner = async (command, args) => {
      if (command === "pdfinfo" && !args.includes("-box")) {
        return { stdout: "Pages: 3\n", stderr: "" };
      }
      if (command === "pdfinfo") {
        return { stdout: "Pages: 1\nPage    1 size: 612 x 792 pts\n", stderr: "" };
      }
      if (command === "pdftotext") {
        await writeFile(args.at(-1), "");
        return { stdout: "", stderr: "" };
      }
      if (command === "pdftoppm") {
        await writeFile(`${args.at(-1)}.jpg`, Buffer.alloc(800, 0xff));
        return { stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command: ${command}`);
    };
    const result = await processPdfSpatially({
      inputPath: join(workDir, "input.pdf"),
      outputPath: join(workDir, "output.pdf"),
      geometryPath: join(workDir, "geometry.json.gz"),
      workDir,
      commandRunner: boundaryRunner,
      googleClient: {
        async redactAndAnnotate(pages) {
          googlePages = pages.length;
          return {
            responses: pages.map(() => ({ fullTextAnnotation: { pages: [] } })),
            redactionCounts: {}, redactionRegions: [], redactedPages: pages,
            visionPageTransforms: identityVisionPageTransforms(pages),
          };
        },
      },
      resourceLimits: { maxDocumentPages: 3, maxDocumentRasterBytes: 2_400 },
    });
    assert.equal(googlePages, 3);
    assert.equal(result.status, "needs_review");
    assert.equal(result.unreadablePageCount, 3);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("reel støjside vælges i en lavere gyldig JPEG-profil", runtimeOnly, async () => {
  const workDir = await mkdtemp(join(tmpdir(), "dfks-dlp-real-adaptive-"));
  try {
    const inputPath = join(workDir, "input.pdf");
    await run("python3", ["-c", `
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
import os, sys
image_path, pdf_path = sys.argv[1], sys.argv[2]
width, height = 2550, 3300
Image.frombytes("L", (width, height), os.urandom(width * height)).save(image_path, "PNG")
c = canvas.Canvas(pdf_path, pagesize=letter)
c.drawImage(image_path, 0, 0, width=letter[0], height=letter[1])
c.showPage()
c.save()
`, join(workDir, "noise.png"), inputPath]);
    let googleCalls = 0;
    const result = await processPdfSpatially({
      inputPath,
      outputPath: join(workDir, "output.pdf"),
      geometryPath: join(workDir, "geometry.json.gz"),
      workDir,
      commandRunner,
      googleClient: {
        async redactAndAnnotate(pages) {
          googleCalls += 1;
          assert.equal(pages.length, 1);
          assert.equal(pages[0].imageBytes[0], 0xff);
          assert.equal(pages[0].imageBytes[1], 0xd8);
          const dimensions = await run("python3", ["-c", `
from PIL import Image
import io, json, sys
image = Image.open(io.BytesIO(sys.stdin.buffer.read()))
print(json.dumps([image.width, image.height]))
`], { input: pages[0].imageBytes });
          const [width, height] = JSON.parse(dimensions.toString("utf8"));
          assert.equal(width < 2550 && height < 3300, true, JSON.stringify({ width, height }));
          return {
            responses: [{ fullTextAnnotation: { pages: [] } }],
            redactionCounts: {}, redactionRegions: [], redactedPages: pages,
            visionPageTransforms: identityVisionPageTransforms(pages, width, height),
          };
        },
      },
    });
    assert.equal(result.status, "needs_review");
    assert.equal(googleCalls, 1);
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
