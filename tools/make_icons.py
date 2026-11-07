# Rasterizes the wrench mark into the PWA icon set (no SVG renderer needed).
import math, re, sys
from PIL import Image, ImageDraw

OUT = sys.argv[1]
WRENCH = "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
INK, INK2, YEL = (28, 25, 23), (42, 37, 35), (255, 194, 26)

def arc_points(x1, y1, rx, ry, phi, fa, fs, x2, y2, n=48):
    phi = math.radians(phi)
    c, s = math.cos(phi), math.sin(phi)
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    xp, yp = c * dx + s * dy, -s * dx + c * dy
    lam = xp**2 / rx**2 + yp**2 / ry**2
    if lam > 1:
        rx, ry = rx * math.sqrt(lam), ry * math.sqrt(lam)
    num = rx**2 * ry**2 - rx**2 * yp**2 - ry**2 * xp**2
    den = rx**2 * yp**2 + ry**2 * xp**2
    coef = (-1 if fa == fs else 1) * math.sqrt(max(0, num / den))
    cxp, cyp = coef * rx * yp / ry, -coef * ry * xp / rx
    cx, cy = c * cxp - s * cyp + (x1 + x2) / 2, s * cxp + c * cyp + (y1 + y2) / 2
    ang = lambda ux, uy, vx, vy: math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry)
    dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry)
    if not fs and dt > 0: dt -= 2 * math.pi
    if fs and dt < 0: dt += 2 * math.pi
    pts = []
    for i in range(1, n + 1):
        t = t1 + dt * i / n
        pts.append((c * rx * math.cos(t) - s * ry * math.sin(t) + cx, s * rx * math.cos(t) + c * ry * math.sin(t) + cy))
    return pts

def path_points(d):
    toks = re.findall(r"[MmLlAaZz]|-?\d*\.?\d+", d)
    i, cmd, x, y, pts = 0, None, 0.0, 0.0, []
    while i < len(toks):
        if re.match(r"[A-Za-z]", toks[i]):
            cmd = toks[i]; i += 1
            if cmd in "Zz": continue
        nums = lambda k: [float(v) for v in toks[i:i + k]]
        if cmd == "M":
            x, y = nums(2); i += 2; pts.append((x, y)); cmd = "L"
        elif cmd == "l":
            a, b = nums(2); i += 2; x, y = x + a, y + b; pts.append((x, y))
        elif cmd == "a":
            rx, ry, rot, fa, fs, a, b = nums(7); i += 7
            pts += arc_points(x, y, rx, ry, rot, int(fa), int(fs), x + a, y + b)
            x, y = x + a, y + b
    return pts

def render(size, scale, bg_full, stroke=1.1, ss=4):
    S = size * ss
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    if bg_full:
        dr.rectangle([0, 0, S, S], fill=INK)
    else:
        # vertical gradient inside a rounded square
        grad = Image.new("RGBA", (S, S))
        gd = ImageDraw.Draw(grad)
        for yy in range(S):
            t = yy / S
            gd.line([(0, yy), (S, yy)], fill=tuple(int(INK2[k] + (INK[k] - INK2[k]) * t) for k in range(3)) + (255,))
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
        im.paste(grad, (0, 0), mask)
        dr = ImageDraw.Draw(im)
    k = scale * S / 512
    cx, cy = S / 2, S / 2 + 6 * S / 512
    pts = [((px - 12) * k + cx, (py - 12) * k + cy) for px, py in path_points(WRENCH)]
    dr.polygon(pts, fill=YEL)
    dr.line(pts + [pts[0], pts[1]], fill=YEL, width=max(1, int(stroke * k)), joint="curve")
    return im.resize((size, size), Image.LANCZOS)

big = render(512, 15.5, False)
big.save(f"{OUT}/icon-512.png")
render(192, 15.5, False).save(f"{OUT}/icon-192.png")
render(512, 11, True).save(f"{OUT}/maskable-512.png")
render(192, 11, True).save(f"{OUT}/maskable-192.png")
render(180, 12.5, True).convert("RGB").save(f"{OUT}/apple-touch-icon.png")
render(64, 15.5, False).save(f"{OUT}/favicon-64.png")
print("ok")
