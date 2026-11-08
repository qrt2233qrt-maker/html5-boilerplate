import sys
import cv2
import numpy as np
src, out = sys.argv[1], sys.argv[2]
IN_CRUST, OUT_IN, OUT_OUT = float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
im = cv2.imread(src)
h, w = im.shape[:2]
hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
m = cv2.inRange(hsv, (6, 70, 150), (28, 255, 255))
m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (61, 61)))
cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
inside = [k for k in cnts if cv2.pointPolygonTest(k, (w / 2, h / 2), False) >= 0]
(cx, cy), R = cv2.minEnclosingCircle(cv2.convexHull(max(inside or cnts, key=cv2.contourArea)))
R *= 0.985
print('centre', round(cx), round(cy), 'R', round(R))

yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
dx, dy = xx - cx, yy - cy
p = np.hypot(dx, dy) / R  # output radius in pizza radii
# piecewise-linear inverse map (output radius -> input radius):
# toppings 0..IN_CRUST squeezed into 0..OUT_IN, crust IN_CRUST..1 widened to OUT_IN..OUT_OUT,
# then the paper eases back to unchanged by 1.4
src_r = np.interp(p, [0, OUT_IN, OUT_OUT, 1.4, 10], [0, IN_CRUST, 1.0, 1.4, 10])
s = np.where(p > 0, src_r / np.maximum(p, 1e-6), 1).astype(np.float32)
res = cv2.remap(im, (cx + dx * s).astype(np.float32), (cy + dy * s).astype(np.float32),
                cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT).astype(np.float32)

# raised-rim shading in output coordinates
g = lambda x, mu, sd: np.exp(-0.5 * ((x - mu) / sd) ** 2)
mid = (OUT_IN + OUT_OUT) / 2
width = OUT_OUT - OUT_IN
# light from the top-left: highlight stronger on that side of the rim
light = 0.55 + 0.45 * np.clip(-(dx + dy) / (np.hypot(dx, dy) * 1.4142 + 1e-6), 0, 1)
gain = 1 + 0.10 * g(p, mid - width * 0.1, width * 0.28) * light
gain -= 0.12 * g(p, OUT_IN - width * 0.05, width * 0.18)   # crease where rim meets toppings
# drop shadow on the paper, offset towards the bottom-right
ps = np.hypot(dx - R * 0.025, dy - R * 0.03) / R
gain -= 0.30 * g(ps, OUT_OUT + width * 0.08, width * 0.22) * (p > OUT_OUT - width * 0.05)
res = np.clip(res * gain[..., None], 0, 255).astype(np.uint8)
cv2.imwrite(out, res, [cv2.IMWRITE_JPEG_QUALITY, 95])
