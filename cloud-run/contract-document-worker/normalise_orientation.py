#!/usr/bin/env python3
"""Rotate an OCR source raster without adding metadata or lossy encoding."""

import sys

from PIL import Image


TRANSPOSE = {
    0: None,
    90: Image.Transpose.ROTATE_90,
    180: Image.Transpose.ROTATE_180,
    270: Image.Transpose.ROTATE_270,
}


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: normalise_orientation.py INPUT OUTPUT DEGREES")
    source_path, output_path, raw_degrees = sys.argv[1:]
    try:
        degrees = int(raw_degrees)
    except ValueError as error:
        raise SystemExit("invalid orientation correction") from error
    if degrees not in TRANSPOSE:
        raise SystemExit("invalid orientation correction")

    with Image.open(source_path) as source:
        source.load()
        image = source.convert("RGB")
        operation = TRANSPOSE[degrees]
        if operation is not None:
            image = image.transpose(operation)
        # PNG is deliberate: source pixels must not receive another lossy JPEG
        # encoding before the searchable PDF is assembled.
        image.save(output_path, "PNG", optimize=False)


if __name__ == "__main__":
    main()
