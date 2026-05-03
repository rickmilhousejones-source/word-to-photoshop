"""Dump OpenType 'name' table entries for comparing fonts.

Requires: pip install fonttools

Examples:
  python tools/dump_font_names.py
  python tools/dump_font_names.py "C:\\Users\\you\\Desktop\\fonts_folder"
  python tools/dump_font_names.py "C:\\Windows\\Fonts\\msyh.ttc"
"""
from __future__ import annotations

import argparse
import os
import sys

try:
    from fontTools.ttLib import TTFont
except ImportError:
    print("Install fonttools: pip install fonttools", file=sys.stderr)
    sys.exit(1)


def dump_names(path: str) -> None:
    f = TTFont(path)
    name = f.get("name")
    print("===", os.path.basename(path), "===")
    rows = []
    for rec in name.names:
        if rec.nameID in (1, 2, 3, 4, 6, 16, 17, 18):
            try:
                s = rec.toUnicode()
            except Exception:
                s = str(rec.string)
            rows.append((rec.nameID, rec.platformID, rec.platEncID, rec.langID, s))
    rows.sort(key=lambda x: (x[0], x[1], x[3]))
    for name_id, plat, enc, lang, s in rows:
        print(f"  nameID={name_id} platform={plat} enc={enc} lang={lang}: {s!r}")
    f.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Dump name IDs 1,2,3,4,6,16-18 from font files.")
    ap.add_argument(
        "path",
        nargs="?",
        default=r"C:\Users\whhai\Desktop\新建文件夹",
        help="Folder containing .ttf/.otf/.ttc, or a single font file",
    )
    args = ap.parse_args()
    target = args.path
    if os.path.isfile(target):
        dump_names(target)
        return
    if not os.path.isdir(target):
        print("Not a file or directory:", target, file=sys.stderr)
        sys.exit(1)
    found = False
    for fn in sorted(os.listdir(target)):
        if fn.lower().endswith((".ttf", ".otf", ".ttc")):
            found = True
            dump_names(os.path.join(target, fn))
    if not found:
        print("No .ttf/.otf/.ttc in:", target, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
