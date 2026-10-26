import sys
import cv2
import numpy as np
src, out, dbg = sys.argv[1], sys.argv[2], sys.argv[3]
im = cv2.imread(src)
h, w = im.shape[:2]
hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
# baked crust / sauce / browned cheese: warm hue with real saturation (paper and table are grey/white/black)
m = cv2.inRange(hsv, (6, 70, 150), (28, 255, 255))
m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (61, 61)))
cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
# the pizza is the blob that covers the image centre
inside = [k for k in cnts if cv2.pointPolygonTest(k, (w / 2, h / 2), False) >= 0]
c = max(inside or cnts, key=cv2.contourArea)
hull = cv2.convexHull(c)
(cx, cy), (a, b), ang = cv2.fitEllipse(hull)
print('ellipse centre', round(cx), round(cy), 'axes', round(a), round(b), 'angle', round(ang, 1), 'ratio', round(max(a, b) / min(a, b), 3))
# affine: rotate ellipse axes onto x/y, scale both axes to the mean diameter, rotate back
d = (a + b) / 2
t = np.deg2rad(ang)
R = np.array([[np.cos(t), np.sin(t)], [-np.sin(t), np.cos(t)]])
S = np.diag([d / a, d / b])
A = R.T @ S @ R
# keep the pizza centre at the image centre
centre = np.array([w / 2, h / 2])
off = centre - A @ np.array([cx, cy])
M = np.hstack([A, off.reshape(2, 1)])
warped = cv2.warpAffine(im, M, (w, h), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)
cv2.imwrite(out, warped, [cv2.IMWRITE_JPEG_QUALITY, 95])
# debug: fitted ellipse on the input
d_im = im.copy()
cv2.ellipse(d_im, ((cx, cy), (a, b), ang), (0, 255, 0), 4)
cv2.circle(d_im, (int(cx), int(cy)), int(d / 2), (255, 0, 255), 2)
cv2.imwrite(dbg, d_im)
