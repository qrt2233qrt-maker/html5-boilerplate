import sys
import cv2
import numpy as np
src, out = sys.argv[1], sys.argv[2]
im = cv2.imread(src)
h, w = im.shape[:2]
hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
# the dish = bright or saturated area (bowl, bread, food); the table is dark
bluish = (hsv[..., 0] > 95) & (hsv[..., 0] < 165) & (hsv[..., 1] > 40) & (hsv[..., 2] < 225)  # coloured glare, not white bowls
dish = (((hsv[..., 2] > 150) | ((hsv[..., 1] > 90) & (hsv[..., 2] > 90))) & ~bluish).astype(np.uint8) * 255
dish = cv2.morphologyEx(dish, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
dish = cv2.morphologyEx(dish, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (61, 61)))
n, lab, st, _ = cv2.connectedComponentsWithStats(dish)
k = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
mask = (lab == k).astype(np.uint8) * 255
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (101, 101)))
x, y, bw, bh = cv2.boundingRect(mask)
cx, cy = x + bw / 2, y + bh / 2
side = int(min(max(bw, bh) / 0.80, w, h))
l = int(np.clip(cx - side / 2, 0, w - side)); t = int(np.clip(cy - side / 2, 0, h - side))
im = im[t:t + side, l:l + side]; mask = mask[t:t + side, l:l + side]
im = cv2.resize(im, (1200, 1200), interpolation=cv2.INTER_AREA if side > 1200 else cv2.INTER_LANCZOS4)
mask = cv2.resize(mask, (1200, 1200))
soft = cv2.GaussianBlur(mask.astype(np.float32) / 255, (0, 0), 25)[..., None]

f = im.astype(np.float32)
# remove the blue/purple light cast, using the table (should be neutral dark grey)
bg = f[(mask == 0) & (f.mean(axis=2) < 90)]
gain = bg.mean() / np.maximum(bg.mean(axis=0), 1)
f = f * gain
# food: warmer, livelier colour and more local contrast
lab_ = cv2.cvtColor(np.clip(f, 0, 255).astype(np.uint8), cv2.COLOR_BGR2LAB)
L = cv2.createCLAHE(clipLimit=1.4, tileGridSize=(8, 8)).apply(lab_[..., 0])
lab_[..., 0] = L
f2 = cv2.cvtColor(lab_, cv2.COLOR_LAB2BGR).astype(np.float32)
hsv2 = cv2.cvtColor(f2.astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
s = hsv2[..., 1] / 255
hsv2[..., 1] = np.clip((s + 0.30 * s * (1 - s) * 2) * 255, 0, 255)   # vibrance
food = cv2.cvtColor(hsv2.astype(np.uint8), cv2.COLOR_HSV2BGR).astype(np.float32)
lum = food.mean(axis=2) / 255
wk = np.clip((0.85 - lum) / 0.35, 0, 1)                                 # keep whites neutral
food[..., 2] *= 1 + 0.05 * wk; food[..., 0] *= 1 - 0.05 * wk           # warmth on food only
food = 255 * (np.clip(food, 0, 255) / 255) ** 0.93                      # lift midtones
food = np.clip(food * 1.02, 0, 255)
# table: same dark surface, glare and colour cast calmed, slightly deeper
tab = f.copy()
gray = tab.mean(axis=2, keepdims=True)
tab = gray * 0.75 + tab * 0.25
tab = cv2.GaussianBlur(tab, (0, 0), 1.2)
tab = tab * (1 - 0.45 * np.clip((tab - 55) / 110, 0, 1)) * 0.88   # calm glare, keep texture
res = food * soft + tab * (1 - soft)
# soft vignette
yy, xx = np.mgrid[0:1200, 0:1200]
r = np.hypot(xx - 600, yy - 600) / 850
res *= (1 - 0.35 * np.clip(r - 0.45, 0, 1) ** 1.5)[..., None]
res = np.clip(res, 0, 255).astype(np.uint8)
blur = cv2.GaussianBlur(res, (0, 0), 1.6)
res = cv2.addWeighted(res, 1.6, blur, -0.6, 0)
cv2.imwrite(out, res, [cv2.IMWRITE_JPEG_QUALITY, 94])
