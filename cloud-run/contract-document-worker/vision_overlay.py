#!/usr/bin/env python3
"""Build a searchable PDF from source page images and Vision geometry."""

import json
import math
import os
import sys
from io import BytesIO

import pikepdf
from PIL import Image
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

FONT_NAME = "DFKSDejaVu"
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
# Only the locally normalised OCR source reaches this script. If the lossless
# derivative exceeds the portal's 25 MB limit, bounded JPEG encodings are
# generated from that source copy. The immutable legal original is untouched.
DERIVATIVE_JPEG_QUALITIES = (92, 84, 76)


def image_point(u, v, image_width, image_height, width, height):
    return u / image_width * width, height - v / image_height * height


def derivative_image(image_path, geometry, page_number, image_dir, jpeg_quality):
    image_width = int(float(geometry["imageWidth"]))
    image_height = int(float(geometry["imageHeight"]))
    with Image.open(image_path) as image:
        image.load()
        if image.format != "PNG" or image.size != (image_width, image_height):
            raise ValueError("OCR page dimensions do not match Vision geometry")
        if jpeg_quality is None:
            return image_path
        safe_path = os.path.join(
            image_dir, f"derivative-{page_number}-q{jpeg_quality}.jpg"
        )
        image.convert("RGB").save(
            safe_path,
            format="JPEG",
            quality=jpeg_quality,
            optimize=True,
            progressive=True,
            subsampling=2,
        )
        return safe_path


def rebuilt_page(page, geometry, image_path, page_number, image_dir, jpeg_quality):
    media = page.cropbox
    x0, y0, x1, y1 = [float(value) for value in media]
    width, height = x1 - x0, y1 - y0
    rotation = int(page.get("/Rotate", 0)) % 360
    if rotation in (90, 270):
        width, height = height, width
    physical_correction = int(geometry.get("orientationCorrection", 0)) % 360
    if physical_correction in (90, 270):
        width, height = height, width
    image_width = float(geometry["imageWidth"])
    image_height = float(geometry["imageHeight"])
    stream = BytesIO()
    output = canvas.Canvas(stream, pagesize=(width, height), pageCompression=1)
    safe_image_path = derivative_image(
        image_path, geometry, page_number, image_dir, jpeg_quality
    )
    output.drawImage(ImageReader(safe_image_path), 0, 0, width=width, height=height,
                     preserveAspectRatio=False, mask=None)

    for word in geometry.get("words", []):
        text = str(word.get("text", "")).strip()
        vertices = word.get("vertices", [])
        if not text or len(vertices) != 4:
            continue
        points = [image_point(float(v.get("x", 0)), float(v.get("y", 0)), image_width,
                              image_height, width, height) for v in vertices]
        left, right = points[3], points[2]
        target_width = max(0.5, math.dist(left, right))
        target_height = max(1.0, math.dist(points[0], points[3]))
        font_size = target_height
        natural_width = max(0.01, pdfmetrics.stringWidth(text, FONT_NAME, font_size))
        scale = max(1.0, min(1000.0, target_width / natural_width * 100.0))
        angle = math.degrees(math.atan2(right[1] - left[1], right[0] - left[0]))
        _, descent = pdfmetrics.getAscentDescent(FONT_NAME, font_size)
        baseline_offset = -descent
        radians = math.radians(angle)
        text_object = output.beginText()
        text_object.setTextRenderMode(3)
        text_object.setFont(FONT_NAME, font_size)
        text_object.setHorizScale(scale)
        text_object.setTextTransform(math.cos(radians), math.sin(radians),
                                     -math.sin(radians), math.cos(radians),
                                     left[0] - math.sin(radians) * baseline_offset,
                                     left[1] + math.cos(radians) * baseline_offset)
        text_object.textOut(text)
        output.drawText(text_object)

    output.showPage()
    output.save()
    stream.seek(0)
    return stream


def build_pdf(input_path, page_geometry, image_dir, output_path, jpeg_quality):
    candidate_path = output_path + ".candidate"
    if os.path.exists(candidate_path):
        os.remove(candidate_path)
    with pikepdf.open(input_path) as pdf:
        output_pdf = pikepdf.Pdf.new()
        for page_number, page in enumerate(pdf.pages, start=1):
            geometry = page_geometry.get(page_number)
            image_path = os.path.join(image_dir, f"ocr-page-{page_number}.png")
            if geometry is None or not os.path.isfile(image_path):
                raise ValueError("missing OCR page or Vision geometry")
            with pikepdf.open(rebuilt_page(
                page, geometry, image_path, page_number, image_dir, jpeg_quality
            )) as rebuilt:
                output_pdf.pages.append(rebuilt.pages[0])
                output_pdf.pages[-1].CropBox = output_pdf.pages[-1].MediaBox
        output_pdf.save(candidate_path, linearize=True)
    os.replace(candidate_path, output_path)


def main():
    if len(sys.argv) not in (5, 6):
        raise SystemExit(
            "usage: vision_overlay.py INPUT GEOMETRY IMAGE_DIR OUTPUT [MAX_BYTES]"
        )
    input_path, geometry_path, image_dir, output_path = sys.argv[1:5]
    max_bytes = int(sys.argv[5]) if len(sys.argv) == 6 else 0
    if max_bytes < 0 or max_bytes > 100 * 1024 * 1024:
        raise ValueError("invalid derivative byte limit")
    with open(geometry_path, "r", encoding="utf-8") as source:
        geometry = json.load(source)
    page_geometry = {int(item["pageNumber"]): item for item in geometry.get("pages", [])}
    pdfmetrics.registerFont(TTFont(FONT_NAME, FONT_PATH))
    build_pdf(input_path, page_geometry, image_dir, output_path, None)
    if max_bytes and os.path.getsize(output_path) > max_bytes:
        for quality in DERIVATIVE_JPEG_QUALITIES:
            build_pdf(input_path, page_geometry, image_dir, output_path, quality)
            if os.path.getsize(output_path) <= max_bytes:
                break


if __name__ == "__main__":
    main()
