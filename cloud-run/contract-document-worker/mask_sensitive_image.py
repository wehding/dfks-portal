#!/usr/bin/env python3
"""Mask DLP-provided pixel boxes locally without writing image data to disk."""

import io
import json
import sys

from PIL import Image, ImageDraw


def main():
    if len(sys.argv) != 2:
        raise SystemExit("invalid arguments")
    boxes = json.loads(sys.argv[1])
    if not isinstance(boxes, list) or len(boxes) > 2000:
        raise SystemExit("invalid boxes")

    source = sys.stdin.buffer.read(16 * 1024 * 1024 + 1)
    if not source or len(source) > 16 * 1024 * 1024:
        raise SystemExit("invalid image")

    with Image.open(io.BytesIO(source)) as image:
        image.load()
        if image.format not in {"JPEG", "PNG"}:
            raise SystemExit("unsupported image")
        output_image = image.convert("RGB")
        draw = ImageDraw.Draw(output_image)
        width, height = output_image.size
        for box in boxes:
            left = max(0, int(box["left"]) - 2)
            top = max(0, int(box["top"]) - 2)
            right = min(width, int(box["left"] + box["width"]) + 2)
            bottom = min(height, int(box["top"] + box["height"]) + 2)
            if right <= left or bottom <= top:
                raise SystemExit("invalid box")
            draw.rectangle((left, top, right, bottom), fill=(0, 0, 0))

        output = io.BytesIO()
        output_image.save(output, format="JPEG", quality=95, optimize=True)
        sys.stdout.buffer.write(output.getvalue())


if __name__ == "__main__":
    main()
