import sys, os
import numpy as np
from PIL import Image, ImageFilter
SHEET, AI_DIR, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
XS = [0, 225, 446, 663, 876, 1092, 1313, 1536]
ROWS = [(0, 280), (341, 618), (676, 955)]
# rebuild the same crop boxes split.py used, by matching each AI result back to its cell
import cv2
sheet = cv2.cvtColor(cv2.imread(SHEET), cv2.COLOR_BGR2RGB)
names = sorted(os.listdir(AI_DIR))
order = ['pizza-01-hawaiian', 'pizza-02-beefy-one', 'pizza-03-pepperoni-lovers', 'pizza-04-meaty-feast',
         'pizza-05-cheese', 'pizza-06-chicken-hot', 'pizza-07-americana', 'pizza-08-spicy-hot',
         'pizza-09-free-choice', 'pizza-10-vegan', 'pizza-11-aubergine-hot', 'pizza-12-vegetarian-delight',
         'pizza-13-vegetarian-hot', 'pizza-14-calzone', 'pizza-15-mix-shawarma', 'pizza-16-shawarma-meat',
         'pizza-17-shawarma-chicken', 'special-margherita', 'special-pepperoni', 'special-seafood', 'special-bbq']
rng = np.random.default_rng(7)
k = 0
for (y0, y1) in ROWS:
    for c in range(7):
        x0, x1 = XS[c] + 3, XS[c + 1] - 3
        cell = sheet[y0:y1, x0:x1]
        hsv = cv2.cvtColor(cell, cv2.COLOR_RGB2HSV)
        m = cv2.inRange(hsv, (5, 70, 120), (30, 255, 255))
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
        cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        bx, by, bw, bh = cv2.boundingRect(max(cnts, key=cv2.contourArea))
        cx, cy = bx + bw / 2, by + bh / 2
        side = int(min(max(bw, bh) * 1.06, cell.shape[1], cell.shape[0]))
        l = int(np.clip(cx - side / 2, 0, cell.shape[1] - side))
        t = int(np.clip(cy - side / 2, 0, cell.shape[0] - side))
        plain = Image.fromarray(cell[t:t + side, l:l + side]).resize((1200, 1200), Image.LANCZOS)
        ai = Image.open(f'{AI_DIR}/{order[k]}.jpg').convert('RGB')
        mix = Image.blend(ai, plain, 0.25)
        arr = np.asarray(mix).astype(np.float32)
        grain = rng.normal(0, 3.0, arr.shape[:2])[..., None]  # fine luminance grain
        arr = np.clip(arr + grain, 0, 255).astype(np.uint8)
        out = Image.fromarray(arr).filter(ImageFilter.UnsharpMask(radius=1.2, percent=40, threshold=2))
        out.save(f'{OUT}/{order[k]}.jpg', quality=95, optimize=True)
        k += 1
print('done', k)
