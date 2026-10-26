import sys
import cv2
import numpy as np
import onnxruntime as ort

SHEET, MODEL, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
XS = [0, 225, 446, 663, 876, 1092, 1313, 1536]
ROWS = [(0, 280), (341, 618), (676, 955)]  # pizza area of each row, above the name label
NAMES = [
    'pizza-01-hawaiian', 'pizza-02-beefy-one', 'pizza-03-pepperoni-lovers', 'pizza-04-meaty-feast',
    'pizza-05-cheese', 'pizza-06-chicken-hot', 'pizza-07-americana',
    'pizza-08-spicy-hot', 'pizza-09-free-choice', 'pizza-10-vegan', 'pizza-11-aubergine-hot',
    'pizza-12-vegetarian-delight', 'pizza-13-vegetarian-hot', 'pizza-14-calzone',
    'pizza-15-mix-shawarma', 'pizza-16-shawarma-meat', 'pizza-17-shawarma-chicken',
    'special-margherita', 'special-pepperoni', 'special-seafood', 'special-bbq',
]
sess = ort.InferenceSession(MODEL, providers=['CPUExecutionProvider'])
IN = sess.get_inputs()[0].name

def upscale4(rgb):
    """Real-ESRGAN x4 on 64x64 tiles with 8px overlap, feathered seams."""
    T, P = 64, 8
    h, w = rgb.shape[:2]
    pad = cv2.copyMakeBorder(rgb, P, P + T, P, P + T, cv2.BORDER_REFLECT).astype(np.float32) / 255.0
    out = np.zeros(((h + 2 * P + T) * 4, (w + 2 * P + T) * 4, 3), np.float32)
    wsum = np.zeros(out.shape[:2], np.float32)
    ramp = np.minimum(np.arange(T * 4) + 1, np.arange(T * 4)[::-1] + 1).astype(np.float32)
    win = np.minimum(np.minimum.outer(ramp, ramp), P * 4 * 2)
    step = T - 2 * P
    for y in range(0, h + P, step):
        for x in range(0, w + P, step):
            tile = pad[y:y + T, x:x + T]
            res = sess.run(None, {IN: tile.transpose(2, 0, 1)[None]})[0][0].transpose(1, 2, 0)
            out[y * 4:(y + T) * 4, x * 4:(x + T) * 4] += res * win[..., None]
            wsum[y * 4:(y + T) * 4, x * 4:(x + T) * 4] += win
    out = out / np.maximum(wsum, 1e-6)[..., None]
    out = out[P * 4:(P + h) * 4, P * 4:(P + w) * 4]
    return np.clip(out * 255, 0, 255).astype(np.uint8)

sheet = cv2.cvtColor(cv2.imread(SHEET), cv2.COLOR_BGR2RGB)
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
        crop = cell[t:t + side, l:l + side]
        big = upscale4(crop)
        big = cv2.resize(big, (1200, 1200), interpolation=cv2.INTER_LANCZOS4)
        cv2.imwrite(f'{OUT}/{NAMES[k]}.jpg', cv2.cvtColor(big, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 95])
        print(NAMES[k], 'crop', side, 'px', flush=True)
        k += 1
