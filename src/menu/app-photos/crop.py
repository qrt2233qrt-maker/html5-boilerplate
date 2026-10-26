import sys
from PIL import Image, ImageFilter, ImageEnhance
U = '/root/.claude/uploads/c77bb0e2-7c23-51b2-9808-f96c840d315b/'
OUT = sys.argv[1]
# (source, output name, square crop box: left, top, size)
JOBS = [
    ('bcd3a751-image.jpg', 'saj-italian-pepperoni',          (64, 300, 592)),
    ('53535584-image.jpg', 'saj-italian-shawarma-meat',      (64, 300, 592)),
    ('03bd9476-image.jpg', 'saj-italian-shawarma-chicken',   (29, 214, 662)),
    ('890a4fc2-image.jpg', 'saj-italian-tandoori-chicken',   (64, 300, 592)),
    ('de1108bc-image.jpg', 'pizza-11-aubergine-hot',         (162, 226, 436)),
    ('8ac65cbb-image.jpg', 'pizza-07-americana',             (162, 226, 436)),
    ('ab78306c-image.jpg', 'pizza-08-spicy-hot',             (162, 226, 436)),
    ('9eb92dee-image.jpg', 'pizza-10-vegan',                 (162, 226, 436)),
    ('1e6f3275-image.jpg', 'pizza-03-pepperoni-lovers',      (162, 226, 436)),
    ('6534cba3-image.jpg', 'pizza-02-beefy-one',             (162, 226, 436)),
    ('4c8a0f38-image.jpg', 'pizza-06-chicken-hot',           (162, 226, 436)),
    ('3103a51f-image.png', 'pizza-04-meaty-feast',           (291, 719, 780)),
    ('81e0f7d3-image.jpg', 'pizza-05-chinese',               (162, 226, 436)),
    ('019d8627-image.jpg', 'pizza-14-calzone',               (330, 310, 680)),
]
for src, name, (l, t, s) in JOBS:
    im = Image.open(U + src).convert('RGB')
    assert l >= 0 and t >= 0 and l + s <= im.width and t + s <= im.height, (src, im.size)
    c = im.crop((l, t, l + s, t + s))
    # upscale to the 1200x1200 delivery-app size, then a light sharpen to offset the enlargement
    c = c.resize((1200, 1200), Image.LANCZOS)
    c = c.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
    c.save(f'{OUT}/{name}.jpg', quality=92, optimize=True)
    print(name, 'from', s, 'px')
