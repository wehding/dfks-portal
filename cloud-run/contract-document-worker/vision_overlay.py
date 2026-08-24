#!/usr/bin/env python3
"""Attach an invisible, geometrically positioned Vision text layer to a PDF."""

import json
import math
import sys
from io import BytesIO

import pikepdf
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

FONT_NAME = "DFKSDejaVu"
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def point_for_rotation(u, v, image_width, image_height, width, height, rotation):
    if rotation == 90:
        return v / image_height * width, u / image_width * height
    if rotation == 180:
        return width - u / image_width * width, v / image_height * height
    if rotation == 270:
        return width - v / image_height * width, height - u / image_width * height
    return u / image_width * width, height - v / image_height * height


def overlay_for_page(page, geometry):
    media = page.cropbox
    x0, y0, x1, y1 = [float(value) for value in media]
    width, height = x1 - x0, y1 - y0
    rotation = int(page.get("/Rotate", 0)) % 360
    image_width = float(geometry["imageWidth"])
    image_height = float(geometry["imageHeight"])
    stream = BytesIO()
    output = canvas.Canvas(stream, pagesize=(width, height), pageCompression=1)

    for word in geometry.get("words", []):
        text = str(word.get("text", "")).strip()
        vertices = word.get("vertices", [])
        if not text or len(vertices) != 4:
            continue
        points = [point_for_rotation(float(v.get("x", 0)), float(v.get("y", 0)), image_width,
                                     image_height, width, height, rotation) for v in vertices]
        left, right = points[3], points[2]
        target_width = max(0.5, math.dist(left, right))
        target_height = max(1.0, math.dist(points[0], points[3]))
        font_size = target_height
        natural_width = max(0.01, pdfmetrics.stringWidth(text, FONT_NAME, font_size))
        scale = max(1.0, min(1000.0, target_width / natural_width * 100.0))
        angle = math.degrees(math.atan2(right[1] - left[1], right[0] - left[0]))
        text_object = output.beginText()
        text_object.setTextRenderMode(3)
        text_object.setFont(FONT_NAME, font_size)
        text_object.setHorizScale(scale)
        text_object.setTextTransform(math.cos(math.radians(angle)), math.sin(math.radians(angle)),
                                     -math.sin(math.radians(angle)), math.cos(math.radians(angle)),
                                     left[0], left[1])
        text_object.textOut(text)
        output.drawText(text_object)

    output.showPage()
    output.save()
    stream.seek(0)
    return stream


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: vision_overlay.py INPUT GEOMETRY OUTPUT")
    input_path, geometry_path, output_path = sys.argv[1:]
    with open(geometry_path, "r", encoding="utf-8") as source:
        geometry = json.load(source)
    page_geometry = {int(item["pageNumber"]): item for item in geometry.get("pages", [])}
    pdfmetrics.registerFont(TTFont(FONT_NAME, FONT_PATH))
    with pikepdf.open(input_path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            if page_number not in page_geometry:
                continue
            with pikepdf.open(overlay_for_page(page, page_geometry[page_number])) as overlay:
                page.add_overlay(overlay.pages[0])
        pdf.save(output_path, linearize=True)


if __name__ == "__main__":
    main()
