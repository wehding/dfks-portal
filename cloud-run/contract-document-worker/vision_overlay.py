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
# derivative exceeds the portal's 25 MB limit, deterministic raster profiles
# are tried in descending fidelity. Full-resolution JPEG is tried before any
# downscaling. The floor is deliberately 150 DPI: a document that is still too
# large at that resolution must remain fail-closed as processed_file_too_large
# in the caller. The immutable legal original, page dimensions and invisible
# Vision text geometry are never modified.
DERIVATIVE_RASTER_PROFILES = (
    (None, None),
    (None, 92),
    (None, 84),
    (225, 90),
    (200, 90),
    (175, 90),
    (150, 90),
)

# The existing primary transform is intentionally unchanged. The bounded
# alternatives only alter how the invisible text matrix is fitted to the same
# Google Vision polygon. The worker independently audits every candidate and
# may only keep the first one that passes every existing quality gate.
OVERLAY_PROFILES = (
    "primary-v1",
    "font-metrics-v1",
    "axis-aligned-font-metrics-v1",
)


def image_point(u, v, image_width, image_height, width, height):
    return u / image_width * width, height - v / image_height * height


def derivative_image(
    image_path,
    geometry,
    page_number,
    image_dir,
    target_dpi,
    jpeg_quality,
    page_width,
    page_height,
):
    image_width = int(float(geometry["imageWidth"]))
    image_height = int(float(geometry["imageHeight"]))
    with Image.open(image_path) as image:
        image.load()
        if image.format != "PNG" or image.size != (image_width, image_height):
            raise ValueError("OCR page dimensions do not match Vision geometry")
        if target_dpi is None and jpeg_quality is None:
            return image_path
        if target_dpi is None:
            scale = 1.0
        else:
            maximum_width = max(1, int(round(page_width * target_dpi / 72.0)))
            maximum_height = max(1, int(round(page_height * target_dpi / 72.0)))
            scale = min(
                1.0,
                maximum_width / image_width,
                maximum_height / image_height,
            )
        derivative_width = max(1, int(round(image_width * scale)))
        derivative_height = max(1, int(round(image_height * scale)))
        profile_name = (
            f"full-q{jpeg_quality}"
            if target_dpi is None
            else f"{target_dpi}dpi-q{jpeg_quality}"
        )
        safe_path = os.path.join(
            image_dir, f"derivative-{page_number}-{profile_name}.jpg"
        )
        derivative = image.convert("RGB")
        if derivative.size != (derivative_width, derivative_height):
            derivative = derivative.resize(
                (derivative_width, derivative_height),
                Image.Resampling.LANCZOS,
            )
        derivative.save(
            safe_path,
            format="JPEG",
            quality=jpeg_quality,
            optimize=True,
            progressive=True,
            subsampling=1,
        )
        return safe_path


def word_transform(points, text, overlay_profile):
    if overlay_profile == "axis-aligned-font-metrics-v1":
        x_values = [point[0] for point in points]
        y_values = [point[1] for point in points]
        left = (min(x_values), min(y_values))
        right = (max(x_values), min(y_values))
        target_width = max(0.5, max(x_values) - min(x_values))
        target_height = max(1.0, max(y_values) - min(y_values))
        angle = 0.0
    else:
        left, right = points[3], points[2]
        target_width = max(0.5, math.dist(left, right))
        target_height = max(1.0, math.dist(points[0], points[3]))
        angle = math.degrees(math.atan2(right[1] - left[1], right[0] - left[0]))

    if overlay_profile == "primary-v1":
        # SECURITY/COMPATIBILITY: this is the pre-fallback transform verbatim.
        font_size = target_height
    else:
        ascent_at_one, descent_at_one = pdfmetrics.getAscentDescent(FONT_NAME, 1.0)
        metric_height = max(0.01, ascent_at_one - descent_at_one)
        font_size = target_height / metric_height
    natural_width = max(0.01, pdfmetrics.stringWidth(text, FONT_NAME, font_size))
    horizontal_scale = max(1.0, min(1000.0, target_width / natural_width * 100.0))
    _, descent = pdfmetrics.getAscentDescent(FONT_NAME, font_size)
    return left, angle, font_size, horizontal_scale, -descent


def rebuilt_page(
    page,
    geometry,
    image_path,
    page_number,
    image_dir,
    target_dpi,
    jpeg_quality,
    overlay_profile,
):
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
        image_path,
        geometry,
        page_number,
        image_dir,
        target_dpi,
        jpeg_quality,
        width,
        height,
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
        left, angle, font_size, scale, baseline_offset = word_transform(
            points, text, overlay_profile
        )
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


def build_pdf(
    input_path,
    page_geometry,
    image_dir,
    output_path,
    target_dpi,
    jpeg_quality,
    overlay_profile,
):
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
                page,
                geometry,
                image_path,
                page_number,
                image_dir,
                target_dpi,
                jpeg_quality,
                overlay_profile,
            )) as rebuilt:
                output_pdf.pages.append(rebuilt.pages[0])
                output_pdf.pages[-1].CropBox = output_pdf.pages[-1].MediaBox
        output_pdf.save(candidate_path, linearize=True)
    os.replace(candidate_path, output_path)


def main():
    if len(sys.argv) not in (5, 6, 7):
        raise SystemExit(
            "usage: vision_overlay.py INPUT GEOMETRY IMAGE_DIR OUTPUT [MAX_BYTES] [OVERLAY_PROFILE]"
        )
    input_path, geometry_path, image_dir, output_path = sys.argv[1:5]
    max_bytes = int(sys.argv[5]) if len(sys.argv) == 6 else 0
    if len(sys.argv) == 7:
        max_bytes = int(sys.argv[5])
    overlay_profile = sys.argv[6] if len(sys.argv) == 7 else "primary-v1"
    if max_bytes < 0 or max_bytes > 100 * 1024 * 1024:
        raise ValueError("invalid derivative byte limit")
    if overlay_profile not in OVERLAY_PROFILES:
        raise ValueError("invalid overlay profile")
    with open(geometry_path, "r", encoding="utf-8") as source:
        geometry = json.load(source)
    page_geometry = {int(item["pageNumber"]): item for item in geometry.get("pages", [])}
    pdfmetrics.registerFont(TTFont(FONT_NAME, FONT_PATH))
    for target_dpi, jpeg_quality in DERIVATIVE_RASTER_PROFILES:
        build_pdf(
            input_path,
            page_geometry,
            image_dir,
            output_path,
            target_dpi,
            jpeg_quality,
            overlay_profile,
        )
        if not max_bytes or os.path.getsize(output_path) <= max_bytes:
            break


if __name__ == "__main__":
    main()
