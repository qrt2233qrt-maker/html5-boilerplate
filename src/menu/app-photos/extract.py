import sys
from PIL import Image
U = '/root/.claude/uploads/c77bb0e2-7c23-51b2-9808-f96c840d315b/'
OUT = sys.argv[1]
P = (31, 226, 689, 662)  # photo window inside the 720x1280 pizza posts
JOBS = {
    'pizza-02-beefy-one':          ('6534cba3-image.jpg', P),
    'pizza-03-pepperoni-lovers':   ('1e6f3275-image.jpg', P),
    'pizza-04-meaty-feast':        ('3103a51f-image.png', (54, 719, 1229, 1500)),
    'pizza-05-chinese':            ('81e0f7d3-image.jpg', P),
    'pizza-06-chicken-hot':        ('4c8a0f38-image.jpg', P),
    'pizza-07-americana':          ('8ac65cbb-image.jpg', P),
    'pizza-08-spicy-hot':          ('ab78306c-image.jpg', P),
    'pizza-10-vegan':              ('9eb92dee-image.jpg', P),
    'pizza-11-aubergine-hot':      ('de1108bc-image.jpg', P),
    'pizza-14-calzone':            ('019d8627-image.jpg', (140, 342, 1236, 980)),
    'saj-italian-pepperoni':       ('bcd3a751-image.jpg', (64, 321, 656, 859)),
    'saj-italian-shawarma-meat':   ('53535584-image.jpg', (64, 321, 656, 859)),
    'saj-italian-shawarma-chicken':('03bd9476-image.jpg', (30, 300, 690, 870)),
    'saj-italian-tandoori-chicken':('890a4fc2-image.jpg', (64, 321, 656, 859)),
}
for name, (src, box) in JOBS.items():
    im = Image.open(U + src).convert('RGB')
    assert box[2] <= im.width and box[3] <= im.height, name
    im.crop(box).save(f'{OUT}/{name}.png')
    print(name, box[2] - box[0], 'x', box[3] - box[1])
