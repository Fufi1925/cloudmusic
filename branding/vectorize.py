"""Vectorize the 128px CloudMusic icon (cloudmusic-original.webp) into a clean SVG.

Usage: python3 branding/vectorize.py [out.svg]   (needs numpy, opencv-python, pillow, scipy, potrace)

Layers (painter's order):
  bg      rounded rect 4..124 r31 with vertical gradient
  light   traced silhouette of every light element (band, rims, boom, cloud) in band grey
  white   traced white region (cloud body, rim highlights) with the cloud gradient
  cups    dark cup interiors (fitted rounded rects)
  boom    mic boom stroke (drawn over the right cup)
  head    mic head pill
  face    eye halos, eyes, highlights, smile
  dot     green status dot with a background-coloured ring
"""
import os
import re
import subprocess
import sys
import tempfile
import numpy as np
import cv2
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "cloudmusic-original.webp")
S = 16  # supersampling factor for tracing
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "cloudmusic-logo.svg")
TMP = tempfile.mkdtemp(prefix="cloudmusic-trace-")

img = np.array(Image.open(SRC).convert("RGBA")).astype(np.float32)
bgc = np.array([49, 51, 55], np.float32)
a = img[..., 3:4] / 255
rgb = img[..., :3] * a + bgc * (1 - a)
L = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]

Lup = cv2.resize(L, (128 * S, 128 * S), interpolation=cv2.INTER_CUBIC)
rgbup = cv2.resize(rgb, (128 * S, 128 * S), interpolation=cv2.INTER_CUBIC)
yy, xx = (np.mgrid[0 : 128 * S, 0 : 128 * S] + 0.5) / S

def disk(r_units):
    r = int(round(r_units * S))
    y, x = np.ogrid[-r : r + 1, -r : r + 1]
    return x * x + y * y <= r * r

green = (rgbup[..., 1] - rgbup[..., 0]) > 50
green = ndi.binary_dilation(green, structure=disk(0.35))
inside_icon = (np.abs(xx - 64) < 59.5) & (np.abs(yy - 64) < 59.5)

light_cls = (Lup >= 127.5) & ~green & inside_icon
white_cls = (Lup >= 227) & ~green & inside_icon
light_only = light_cls & ~white_cls
# band, rims and boom: the thick light-grey structures (thin AA slivers around the cloud are dropped)
light_core = ndi.binary_opening(light_only, structure=disk(0.9))


def fill_small_holes(mask, max_area_units):
    holes = ndi.binary_fill_holes(mask) & ~mask
    lab, n = ndi.label(holes)
    if n == 0:
        return mask
    sizes = ndi.sum(holes, lab, index=np.arange(1, n + 1)) / (S * S)
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes < max_area_units
    return mask | keep[lab]


def drop_small(mask, min_area_units):
    lab, n = ndi.label(mask)
    if n == 0:
        return mask
    sizes = ndi.sum(mask, lab, index=np.arange(1, n + 1)) / (S * S)
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes >= min_area_units
    return keep[lab]


light_core = drop_small(light_core, 2.0)
# the boom is drawn as a clean stroke; drop the traced copy (rims, head and dot are geometric too)
light_core &= ~((xx > 66) & (yy > 84))


def smooth(mask, sigma_units=0.35):
    return ndi.gaussian_filter(mask.astype(np.float32), sigma_units * S) > 0.5

# white region: everything light that is not band/rim/boom; its edge against the background is the
# plain iso-contour of the source, so it is smooth and needs nothing underneath
W = (Lup >= 140) & ~light_core & ~green & inside_icon
W = smooth(drop_small(fill_small_holes(W, 600), 1.5))
# the light-grey layer reaches 0.6 units under the white so the two never leave a seam
B = light_core | (ndi.binary_dilation(light_core, structure=disk(0.6)) & W)
B = smooth(drop_small(fill_small_holes(B, 600), 2.0))
# the mic head is drawn as a clean pill on top; keep W free of it
W &= ~((yy > 97.5) & (xx > 66) & (xx < 86))


def potrace_paths(mask, name):
    h, w = mask.shape
    pbm = os.path.join(TMP, f"{name}.pbm")
    with open(pbm, "wb") as f:
        f.write(b"P4\n%d %d\n" % (w, h))
        f.write(np.packbits(mask.astype(np.uint8), axis=1).tobytes())
    svg = os.path.join(TMP, f"{name}.trace.svg")
    subprocess.run(
        ["potrace", pbm, "-s", "--flat", "-t", "40", "-a", "1.0", "-O", "0.25", "-u", "10", "-o", svg],
        check=True,
    )
    text = open(svg).read()
    m = re.search(r'transform="translate\(([-\d.]+),([-\d.]+)\) scale\(([-\d.]+),([-\d.]+)\)"', text)
    tx, ty, sx, sy = map(float, m.groups())
    d = " ".join(re.findall(r' d="([^"]+)"', text))
    return convert_path(d, tx, ty, sx, sy)


def convert_path(d, tx, ty, sx, sy):
    """potrace emits relative m/c/l commands in a flipped, scaled frame; make them absolute in icon units."""
    toks = re.findall(r"[MmCcLlZz]|-?\d+(?:\.\d+)?", d)
    out = []
    i = 0
    cx = cy = 0.0
    start = (0.0, 0.0)
    cmd = None

    def T(x, y):
        return ((tx + sx * x) / S, (ty + sy * y) / S)

    def fmt(p):
        return f"{p[0]:.2f} {p[1]:.2f}"

    while i < len(toks):
        t = toks[i]
        if re.match(r"[MmCcLlZz]", t):
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
                x += cx
                y += cy
            cx, cy = x, y
            start = (x, y)
            out.append("M" + fmt(T(x, y)))
            cmd = "l" if cmd == "m" else "L"
        elif cmd in "Ll":
            x, y = float(toks[i]), float(toks[i + 1])
            i += 2
            if cmd == "l":
                x += cx
                y += cy
            cx, cy = x, y
            out.append("L" + fmt(T(x, y)))
        elif cmd in "Cc":
            vals = [float(v) for v in toks[i : i + 6]]
            i += 6
            if cmd == "c":
                vals = [vals[0] + cx, vals[1] + cy, vals[2] + cx, vals[3] + cy, vals[4] + cx, vals[5] + cy]
            cx, cy = vals[4], vals[5]
            out.append("C" + " ".join(fmt(T(vals[k], vals[k + 1])) for k in (0, 2, 4)))
    return "".join(out)


light_d = potrace_paths(B, "light")
white_d = potrace_paths(W, "white")

# ---------------------------------------------------------------- geometry
eyeL = (48.03, 72.50)
eyeR = (78.03, 72.50)
EYE_RX, EYE_RY = 3.45, 4.90
HL_DX, HL_DY, HL_R = 1.32, -1.25, 1.25

svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 128 128">
  <title>CloudMusic</title>
  <defs>
    <linearGradient id="cm-bg" x1="0" y1="4" x2="0" y2="124" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#37393d"/>
      <stop offset="1" stop-color="#2b2d31"/>
    </linearGradient>
    <linearGradient id="cm-cloud" x1="0" y1="37" x2="0" y2="97" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.3" stop-color="#fbfcfd"/>
      <stop offset="0.85" stop-color="#f2f5f8"/>
      <stop offset="0.9" stop-color="#e6ebf0"/>
      <stop offset="0.94" stop-color="#f0f3f6"/>
      <stop offset="1" stop-color="#e1e6ec"/>
    </linearGradient>
    <radialGradient id="cm-halo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0.55" stop-color="#e3e8ee" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#e3e8ee" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="4" y="4" width="120" height="120" rx="31" fill="url(#cm-bg)"/>
  <path fill="#c8cdd4" d="{light_d}"/>
  <path fill="url(#cm-cloud)" d="{white_d}"/>
  <rect x="14.98" y="63.97" width="13.05" height="27.06" rx="6.1" fill="#d3d6dc"/>
  <rect x="99.97" y="63.97" width="13.05" height="27.06" rx="6.1" fill="#d3d6dc"/>
  <rect x="16.08" y="65.07" width="10.85" height="24.86" rx="5" fill="#515761"/>
  <rect x="101.07" y="65.07" width="10.85" height="24.86" rx="5" fill="#515761"/>
  <path d="M105.9 86.7V92C105.9 97.6 100.9 100 95.2 101.1C91 101.9 87.6 102.6 84 102.9" fill="none" stroke="#cbd1d8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="69.03" y="99" width="15" height="7" rx="3.5" fill="#e9edf2"/>
  <ellipse cx="{eyeL[0]}" cy="{eyeL[1]}" rx="7.6" ry="8.4" fill="url(#cm-halo)"/>
  <ellipse cx="{eyeR[0]}" cy="{eyeR[1]}" rx="7.6" ry="8.4" fill="url(#cm-halo)"/>
  <ellipse cx="{eyeL[0]}" cy="{eyeL[1]}" rx="{EYE_RX}" ry="{EYE_RY}" fill="#283449"/>
  <ellipse cx="{eyeR[0]}" cy="{eyeR[1]}" rx="{EYE_RX}" ry="{EYE_RY}" fill="#283449"/>
  <circle cx="{eyeL[0] + HL_DX:.2f}" cy="{eyeL[1] + HL_DY:.2f}" r="{HL_R}" fill="#ffffff"/>
  <circle cx="{eyeR[0] + HL_DX:.2f}" cy="{eyeR[1] + HL_DY:.2f}" r="{HL_R}" fill="#ffffff"/>
  <path d="M58.8 83.2Q63.5 87.9 68.2 83.2" fill="none" stroke="#222e44" stroke-width="2.3" stroke-linecap="round"/>
  <circle cx="105" cy="106" r="9.25" fill="#62cc91" stroke="url(#cm-bg)" stroke-width="3.5"/>
</svg>
"""
open(OUT, "w").write(svg)
print("wrote", OUT, "light", len(light_d), "white", len(white_d))
