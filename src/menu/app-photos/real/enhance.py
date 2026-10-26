import sys
from PIL import Image, ImageEnhance, ImageFilter, ImageDraw, ImageOps
src, out, crop = sys.argv[1], sys.argv[2], sys.argv[3]
im = Image.open(src).convert('RGB')
if crop != 'none':
    l, t, s = map(int, crop.split(','))
    im = im.crop((l, t, l + s, t + s))
im = im.resize((1200, 1200), Image.LANCZOS)
# gentle auto-levels, then warmth, contrast and colour like a food shot
im = ImageOps.autocontrast(im, cutoff=0.5)
r, g, b = im.split()
r = r.point(lambda v: min(255, int(v * 1.06)))
b = b.point(lambda v: int(v * 0.92))
im = Image.merge('RGB', (r, g, b))
im = ImageEnhance.Contrast(im).enhance(1.08)
im = ImageEnhance.Color(im).enhance(1.18)
im = ImageEnhance.Brightness(im).enhance(1.03)
# soft dark-brown vignette towards the corners
mask = Image.new('L', im.size, 0)
ImageDraw.Draw(mask).ellipse((-150, -150, 1350, 1350), fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(160))
dark = Image.new('RGB', im.size, (28, 18, 13))
im = Image.composite(im, Image.blend(im, dark, 0.55), mask)
im = im.filter(ImageFilter.UnsharpMask(radius=2, percent=70, threshold=2))
im.save(out, quality=93, optimize=True)
