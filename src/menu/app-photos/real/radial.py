import sys
import cv2
import numpy as np
src, out = sys.argv[1], sys.argv[2]
im = cv2.imread(src)
h, w = im.shape[:2]
hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
m = cv2.inRange(hsv, (6, 70, 150), (28, 255, 255))
m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (61, 61)))
cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
inside = [k for k in cnts if cv2.pointPolygonTest(k, (w / 2, h / 2), False) >= 0]
c = cv2.convexHull(max(inside or cnts, key=cv2.contourArea)).reshape(-1, 2).astype(float)
M = cv2.moments(c.astype(np.int32))
cx, cy = M['m10'] / M['m00'], M['m01'] / M['m00']
# edge radius per degree, from the hull polygon, smoothed around the circle
ang = np.arctan2(c[:, 1] - cy, c[:, 0] - cx)
rad = np.hypot(c[:, 0] - cx, c[:, 1] - cy)
bins = np.linspace(-np.pi, np.pi, 361)
order = np.argsort(ang)
r_theta = np.interp(bins, ang[order], rad[order], period=2 * np.pi)
k = np.exp(-0.5 * (np.arange(-15, 16) / 6.0) ** 2); k /= k.sum()
r_theta = np.convolve(np.concatenate([r_theta[-15:], r_theta, r_theta[:15]]), k, 'same')[15:-15]
R = float(np.median(r_theta))
print('centre', round(cx), round(cy), 'R', round(R), 'edge min/max', round(r_theta.min()), round(r_theta.max()))
# inverse map: output pixel at radius p, angle t samples input radius p * r(t)/R inside the pizza,
# easing back to no change by 1.35R so the paper/table barely moves
yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
dx, dy = xx - cx, yy - cy
p = np.hypot(dx, dy)
t = np.arctan2(dy, dx)
s_edge = np.interp(t, bins, r_theta) / R
blend = np.clip((p / R - 1.0) / 0.35, 0, 1)
s = s_edge * (1 - blend) + 1.0 * blend
mapx = (cx + dx * s).astype(np.float32)
mapy = (cy + dy * s).astype(np.float32)
res = cv2.remap(im, mapx, mapy, cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)
cv2.imwrite(out, res, [cv2.IMWRITE_JPEG_QUALITY, 95])
