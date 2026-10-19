#!/usr/bin/env python3
"""Render every CloudMusic icon asset from branding/cloudmusic-logo.svg.

Outputs
  build/icon.svg, build/icon.png (1024), build/icon.ico, build/icons/<n>x<n>.png   electron-builder
  public/icon.png (512)                                                          window icon
  src/assets/logo.svg                                                            renderer logo
  android/app/src/main/res/drawable/ic_launcher_foreground.xml                   adaptive icon
  android/app/src/main/res/drawable/ic_launcher_background.xml
  android/app/src/main/res/drawable/ic_launcher_monochrome.xml                   themed icon (Android 13+)
  android/app/src/main/res/drawable/ic_stat_cloudmusic.xml                       notification icon

Usage: python3 branding/generate-icons.py
Needs: rsvg-convert, ImageMagick `convert`, potrace, python3 with numpy + pillow.
"""
import os
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MASTER = os.path.join(HERE, "cloudmusic-logo.svg")
SMALL = os.path.join(HERE, "cloudmusic-logo-small.svg")
RES = os.path.join(ROOT, "android", "app", "src", "main", "res", "drawable")
SVGNS = "{http://www.w3.org/2000/svg}"
TMP = tempfile.mkdtemp(prefix="cloudmusic-icons-")

# adaptive icon: the 128-unit artwork is scaled into the 66dp safe zone of the 108dp canvas
AD_SCALE = 0.5
AD_OFFSET = 54 - 64 * AD_SCALE


def run(*cmd):
    subprocess.run(cmd, check=True)


def build_small_variant():
    """16-24px variant: same artwork zoomed onto the face (root viewBox swap), so it stays readable."""
    root = open(MASTER).read()
    assert 'viewBox="0 0 128 128"' in root
    small = root.replace('viewBox="0 0 128 128"', 'viewBox="16 19 96 96"')
    # squircle mask on the zoomed canvas: the artwork would otherwise reach the square edge
    small = small.replace("</defs>", '<clipPath id="cm-small"><rect x="16" y="19" width="96" height="96" rx="24"/></clipPath>\n  </defs>')
    small = small.replace(
        '<rect x="4" y="4" width="120" height="120" rx="31" fill="url(#cm-bg)"/>',
        '<rect x="16" y="19" width="96" height="96" rx="24" fill="url(#cm-bg)"/>')
    small = small.replace("<path fill=\"#c8cdd4\"", '<g clip-path="url(#cm-small)"><path fill="#c8cdd4"')
    small = small.replace("</svg>", "</g></svg>")
    with open(SMALL, "w") as fh:
        fh.write(small)


def render(svg, size, out):
    run("rsvg-convert", "-w", str(size), "-h", str(size), svg, "-o", out)


def desktop_assets():
    os.makedirs(os.path.join(ROOT, "build", "icons"), exist_ok=True)
    build_small_variant()
    shutil.copyfile(MASTER, os.path.join(ROOT, "build", "icon.svg"))
    shutil.copyfile(MASTER, os.path.join(ROOT, "src", "assets", "logo.svg"))
    render(MASTER, 1024, os.path.join(ROOT, "build", "icon.png"))
    render(MASTER, 512, os.path.join(ROOT, "public", "icon.png"))
    for n in (16, 32, 48, 64, 128, 256, 512):
        render(SMALL if n <= 24 else MASTER, n, os.path.join(ROOT, "build", "icons", f"{n}x{n}.png"))
    render(MASTER, 16, os.path.join(ROOT, "public", "favicon-16x16.png"))
    parts = []
    for n in (16, 24, 32, 48, 64, 128, 256):
        p = os.path.join(TMP, f"ico-{n}.png")
        render(SMALL if n <= 24 else MASTER, n, p)
        parts.append(p)
    run("convert", *parts, os.path.join(ROOT, "build", "icon.ico"))


# ------------------------------------------------------------------ svg -> vector drawable
def f(v):
    return f"{float(v):.3f}".rstrip("0").rstrip(".")


def rect_path(x, y, w, h, r):
    x, y, w, h, r = map(float, (x, y, w, h, r))
    r = min(r, w / 2, h / 2)
    return (f"M{f(x + r)},{f(y)}H{f(x + w - r)}A{f(r)},{f(r)} 0,0 1 {f(x + w)},{f(y + r)}"
            f"V{f(y + h - r)}A{f(r)},{f(r)} 0,0 1 {f(x + w - r)},{f(y + h)}H{f(x + r)}"
            f"A{f(r)},{f(r)} 0,0 1 {f(x)},{f(y + h - r)}V{f(y + r)}A{f(r)},{f(r)} 0,0 1 {f(x + r)},{f(y)}Z")


def ellipse_path(cx, cy, rx, ry):
    cx, cy, rx, ry = map(float, (cx, cy, rx, ry))
    return (f"M{f(cx - rx)},{f(cy)}A{f(rx)},{f(ry)} 0,1 0 {f(cx + rx)},{f(cy)}"
            f"A{f(rx)},{f(ry)} 0,1 0 {f(cx - rx)},{f(cy)}Z")


def argb(hex_color, opacity=1.0):
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return f"#{round(float(opacity) * 255):02X}{h.upper()}"


def lerp_color(c0, c1, t):
    a = [int(c0[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(c1[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(a, b))


tree = ET.parse(MASTER)
svg = tree.getroot()
grads = {}
for g in svg.iter():
    if g.tag in (SVGNS + "linearGradient", SVGNS + "radialGradient"):
        stops = [(float(s.get("offset")), s.get("stop-color"), float(s.get("stop-opacity", "1"))) for s in g]
        grads[g.get("id")] = (g.tag.replace(SVGNS, ""), dict(g.attrib), stops)

bg_kind, bg_attr, bg_stops = grads["cm-bg"]
BG_TOP, BG_BOTTOM = bg_stops[0][1], bg_stops[-1][1]
BG_Y0, BG_Y1 = float(bg_attr["y1"]), float(bg_attr["y2"])


def bg_color_at(y):
    return lerp_color(BG_TOP, BG_BOTTOM, min(1, max(0, (y - BG_Y0) / (BG_Y1 - BG_Y0))))


def gradient_xml(ref, shape_attr, indent):
    kind, attr, stops = grads[ref]
    pad = " " * indent
    items = "".join(f'\n{pad}        <item android:offset="{f(o)}" android:color="{argb(c, a)}"/>' for o, c, a in stops)
    if kind == "linearGradient":
        head = (f'<gradient android:type="linear" android:startX="{f(attr.get("x1", 0))}" android:startY="{f(attr["y1"])}" '
                f'android:endX="{f(attr.get("x2", 0))}" android:endY="{f(attr["y2"])}">')
    else:  # objectBoundingBox radial gradient on an ellipse -> circular gradient of the mean radius
        cx, cy = float(shape_attr["cx"]), float(shape_attr["cy"])
        r = (float(shape_attr["rx"]) + float(shape_attr["ry"])) / 2
        head = f'<gradient android:type="radial" android:centerX="{f(cx)}" android:centerY="{f(cy)}" android:gradientRadius="{f(r)}">'
    return f"\n{pad}    <aapt:attr name=\"android:fillColor\">\n{pad}        {head}{items}\n{pad}        </gradient>\n{pad}    </aapt:attr>\n{pad}"


def drawable_paths(indent=8):
    """Every artwork element except the background squircle, as VectorDrawable <path>s."""
    out = []
    pad = " " * indent
    for el in svg:
        tag = el.tag.replace(SVGNS, "")
        a = el.attrib
        if tag in ("title", "defs"):
            continue
        if tag == "rect" and a.get("fill", "").startswith("url(#cm-bg"):
            continue  # the squircle is the adaptive icon's background layer
        if tag == "rect":
            d = rect_path(a.get("x", 0), a.get("y", 0), a["width"], a["height"], a.get("rx", 0))
        elif tag == "ellipse":
            d = ellipse_path(a["cx"], a["cy"], a["rx"], a["ry"])
        elif tag == "circle":
            d = ellipse_path(a["cx"], a["cy"], a["r"], a["r"])
        elif tag == "path":
            d = a["d"]
        else:
            raise SystemExit(f"unsupported element {tag}")
        fill = a.get("fill", "#000000")
        stroke = a.get("stroke")
        if tag == "circle" and stroke and stroke.startswith("url(#cm-bg"):
            # status dot: the stroke is a gap in background colour around the dot
            cx, cy, r, sw = (float(a[k]) for k in ("cx", "cy", "r", "stroke-width"))
            ring = ellipse_path(cx, cy, r + sw / 2, r + sw / 2)
            out.append(f'{pad}<path android:fillColor="{argb(bg_color_at(cy))}" android:pathData="{ring}"/>')
            d = ellipse_path(cx, cy, r - sw / 2, r - sw / 2)
            stroke = None
        if fill == "none" and stroke:
            caps = f' android:strokeLineCap="{a.get("stroke-linecap", "butt")}"'
            joins = f' android:strokeLineJoin="{a["stroke-linejoin"]}"' if "stroke-linejoin" in a else ""
            out.append(f'{pad}<path android:strokeColor="{argb(stroke)}" android:strokeWidth="{f(a["stroke-width"])}"'
                       f'{caps}{joins} android:pathData="{d}"/>')
        elif fill.startswith("url(#"):
            ref = fill[5:-1]
            out.append(f'{pad}<path android:pathData="{d}">{gradient_xml(ref, a, indent)}</path>')
        else:
            out.append(f'{pad}<path android:fillColor="{argb(fill)}" android:pathData="{d}"/>')
    return "\n".join(out)


HEADER = '<?xml version="1.0" encoding="utf-8"?>\n<!-- generated by branding/generate-icons.py from branding/cloudmusic-logo.svg -->\n'


def write(name, body):
    with open(os.path.join(RES, name), "w") as fh:
        fh.write(HEADER + body)


def android_foreground():
    write("ic_launcher_foreground.xml", f'''<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <group android:translateX="{f(AD_OFFSET)}" android:translateY="{f(AD_OFFSET)}" android:scaleX="{f(AD_SCALE)}" android:scaleY="{f(AD_SCALE)}">
{drawable_paths()}
    </group>
</vector>
''')


def android_background():
    y0 = AD_OFFSET + BG_Y0 * AD_SCALE
    y1 = AD_OFFSET + BG_Y1 * AD_SCALE
    write("ic_launcher_background.xml", f'''<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:pathData="M0,0H108V108H0Z">
        <aapt:attr name="android:fillColor">
            <gradient android:type="linear" android:startX="0" android:startY="{f(y0)}" android:endX="0" android:endY="{f(y1)}">
                <item android:offset="0" android:color="{argb(BG_TOP)}"/>
                <item android:offset="1" android:color="{argb(BG_BOTTOM)}"/>
            </gradient>
        </aapt:attr>
    </path>
</vector>
''')


# ------------------------------------------------------------------ monochrome silhouette
MASK_ROLE = {  # fill colour in the master -> role in the single-colour silhouette
    "#c8cdd4": "on", "url(#cm-cloud)": "on", "#d3d6dc": "on", "#e9edf2": "on", "#cbd1d8": "on",
    "#515761": "off", "#283449": "off", "#222e44": "off", "#ffffff": "skip", "url(#cm-halo)": "skip",
}


def silhouette_path():
    parts = []
    for el in svg:
        tag = el.tag.replace(SVGNS, "")
        if tag in ("title", "defs"):
            continue
        a = dict(el.attrib)
        if tag == "rect" and a.get("fill", "").startswith("url(#cm-bg"):
            continue
        key = a.get("stroke") if a.get("fill") == "none" else a.get("fill")
        if tag == "circle" and a.get("stroke", "").startswith("url(#cm-bg"):
            cx, cy, r, sw = (float(a[k]) for k in ("cx", "cy", "r", "stroke-width"))
            parts.append(f'<circle cx="{cx}" cy="{cy}" r="{r + sw / 2}" fill="#000"/>')
            parts.append(f'<circle cx="{cx}" cy="{cy}" r="{r - sw / 2}" fill="#fff"/>')
            continue
        role = MASK_ROLE.get(key)
        if role is None:
            raise SystemExit(f"no silhouette role for {key}")
        if role == "skip":
            continue
        col = "#fff" if role == "on" else "#000"
        if a.get("fill") == "none":
            a["stroke"] = col
        else:
            a["fill"] = col
        attrs = " ".join(f'{k}="{v}"' for k, v in a.items())
        parts.append(f"<{tag} {attrs}/>")
    mask_svg = os.path.join(TMP, "mask.svg")
    with open(mask_svg, "w") as fh:
        fh.write('<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048" viewBox="0 0 128 128">'
                 '<rect width="128" height="128" fill="#000"/>' + "".join(parts) + "</svg>")
    png = os.path.join(TMP, "mask.png")
    render(mask_svg, 2048, png)
    m = np.array(Image.open(png).convert("L")) > 127
    pbm = os.path.join(TMP, "mask.pbm")
    with open(pbm, "wb") as fh:
        fh.write(b"P4\n2048 2048\n" + np.packbits(m.astype(np.uint8), axis=1).tobytes())
    traced = os.path.join(TMP, "mask.svg.out")
    run("potrace", pbm, "-s", "--flat", "-t", "30", "-a", "1.0", "-O", "0.3", "-u", "10", "-o", traced)
    text = open(traced).read()
    tx, ty, sx, sy = map(float, re.search(
        r'transform="translate\(([-\d.]+),([-\d.]+)\) scale\(([-\d.]+),([-\d.]+)\)"', text).groups())
    return absolute_path(" ".join(re.findall(r' d="([^"]+)"', text)), tx, ty, sx, sy, 2048 / 128)


def absolute_path(d, tx, ty, sx, sy, scale):
    toks = re.findall(r"[MmCcLlZz]|-?\d+(?:\.\d+)?", d)
    out, i, cx, cy, start, cmd = [], 0, 0.0, 0.0, (0.0, 0.0), None

    def T(x, y):
        return f"{f((tx + sx * x) / scale)},{f((ty + sy * y) / scale)}"

    while i < len(toks):
        t = toks[i]
        if t.isalpha():
            cmd = t
            i += 1
            if cmd in "Zz":
                out.append("Z")
                cx, cy = start
            continue
        if cmd in "Mm":
            x, y = float(toks[i]), float(toks[i + 1])
            i += 2
            if cmd == "m":
                x, y = x + cx, y + cy
            cx, cy, start = x, y, (x, y)
            out.append("M" + T(x, y))
            cmd = "l" if cmd == "m" else "L"
        elif cmd in "Ll":
            x, y = float(toks[i]), float(toks[i + 1])
            i += 2
            if cmd == "l":
                x, y = x + cx, y + cy
            cx, cy = x, y
            out.append("L" + T(x, y))
        else:
            v = [float(z) for z in toks[i:i + 6]]
            i += 6
            if cmd == "c":
                v = [v[0] + cx, v[1] + cy, v[2] + cx, v[3] + cy, v[4] + cx, v[5] + cy]
            cx, cy = v[4], v[5]
            out.append("C" + " ".join(T(v[k], v[k + 1]) for k in (0, 2, 4)))
    return "".join(out)


def android_monochrome(sil):
    write("ic_launcher_monochrome.xml", f'''<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <group android:translateX="{f(AD_OFFSET)}" android:translateY="{f(AD_OFFSET)}" android:scaleX="{f(AD_SCALE)}" android:scaleY="{f(AD_SCALE)}">
        <path android:fillColor="#FFFFFFFF" android:pathData="{sil}"/>
    </group>
</vector>
''')


def android_status_icon(sil):
    # artwork spans roughly x 12..116 / y 9..117; fit it into 22 of the 24dp
    s = 22 / 108
    tx, ty = 12 - 64 * s, 12 - 63.25 * s
    write("ic_stat_cloudmusic.xml", f'''<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="24" android:viewportHeight="24">
    <group android:translateX="{f(tx)}" android:translateY="{f(ty)}" android:scaleX="{f(s)}" android:scaleY="{f(s)}">
        <path android:fillColor="#FFFFFFFF" android:pathData="{sil}"/>
    </group>
</vector>
''')


if __name__ == "__main__":
    desktop_assets()
    android_foreground()
    android_background()
    sil = silhouette_path()
    android_monochrome(sil)
    android_status_icon(sil)
    shutil.rmtree(TMP, ignore_errors=True)
    print("icons written")
