import sys
from PIL import Image, ImageFilter, ImageEnhance
im = Image.open('/root/.claude/uploads/c77bb0e2-7c23-51b2-9808-f96c840d315b/019d8627-image.jpg').convert('RGB')
# the calzone itself, below the title text and above the "available toppings" strip
box = (130, 345, 1240, 975)
food = im.crop(box)
W = box[2] - box[0]
# square canvas: blurred, darkened stretch of the same photo, with the sharp food band in the middle
bg = food.resize((W, W), Image.LANCZOS).filter(ImageFilter.GaussianBlur(40))
bg = ImageEnhance.Brightness(bg).enhance(0.55)
top = (W - food.height) // 2
# feather the band's top and bottom edges so it blends into the blurred fill
mask = Image.new('L', food.size, 255)
fade = 40
for y in range(fade):
    a = int(255 * y / fade)
    for yy in (y, food.height - 1 - y):
        mask.paste(a, (0, yy, food.width, yy + 1))
bg.paste(food, (0, top), mask)
out = bg.resize((1200, 1200), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=2, percent=50, threshold=2))
out.save(sys.argv[1], quality=92, optimize=True)
