"""Recreate code-native brand graphics (optional, requires Pillow and a CJK font)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import glob
import math
import random

assets = Path(__file__).resolve().parents[1] / "public/assets"
fonts = glob.glob("/System/Library/AssetsV2/**/PingFang.ttc", recursive=True)
font_path = fonts[0] if fonts else "/System/Library/Fonts/Hiragino Sans GB.ttc"
scale = 2
card = Image.new("RGB", (1200 * scale, 630 * scale), "#100e20")
draw = ImageDraw.Draw(card)

def text(x, y, value, size, color):
    draw.text((x * scale, y * scale), value, font=ImageFont.truetype(font_path, size * scale), fill=color)

def mark(image, box):
    target = ImageDraw.Draw(image)
    x, y, size = box
    for center, top, bottom in [(48, 96, 160), (88, 32, 224), (128, 64, 192), (168, 96, 160), (208, 80, 176)]:
        radius = 12 * size / 256
        cx = x + center * size / 256
        target.rounded_rectangle((cx - radius, y + top * size / 256 - radius, cx + radius, y + bottom * size / 256 + radius), radius=radius, fill="#b69aff")

random.seed(12)
for _ in range(4500):
    x = random.uniform(620, 1180)
    ribbon = random.choice([-1, 0, 1])
    y = 296 + math.sin((x - 620) / 76) * 52 + ribbon * 27 + random.gauss(0, 12)
    radius = random.uniform(.6, 1.4) * scale
    color = random.choice(["#9b91c8", "#abcfec", "#becfe4", "#8275ae"])
    draw.ellipse((x * scale - radius, y * scale - radius, x * scale + radius, y * scale + radius), fill=color)
mark(card, (78 * scale, 93 * scale, 72 * scale))
english_base = card.copy()
text(170, 97, "声悦配音", 62, "#f3efff")
text(82, 230, "本地 AI 配音工作台", 38, "#e2d6ff")
text(83, 323, "课程讲解 · 多角色对白 · 离线生成", 23, "#c4bcd3")
text(83, 475, "好声音，让表达更动人", 25, "#b5a0e7")
text(83, 530, "Mac / Windows  ·  创作需购买授权并激活", 19, "#a9a0bb")
card.resize((1200, 630), Image.Resampling.LANCZOS).save(assets / "social-card.png", optimize=True)
card = english_base
draw = ImageDraw.Draw(card)
text(170, 107, "Shengyue Voice", 43, "#f3efff")
text(82, 230, "Your local AI voice studio", 31, "#e2d6ff")
text(83, 323, "Courses · Characters · Offline narration", 20, "#c4bcd3")
text(83, 475, "Bring your words to life", 25, "#b5a0e7")
text(83, 530, "Mac / Windows · Paid activation required", 18, "#a9a0bb")
card.resize((1200, 630), Image.Resampling.LANCZOS).save(assets / "social-card-en.png", optimize=True)
for filename, size, background in [("brand-logo.png", 512, (0, 0, 0, 0)), ("favicon-48.png", 48, (0, 0, 0, 0)), ("apple-touch-icon.png", 180, "#100e20")]:
    icon = Image.new("RGBA", (size * scale, size * scale), background)
    mark(icon, (0, 0, size * scale))
    icon.resize((size, size), Image.Resampling.LANCZOS).save(assets / filename, optimize=True)
print("Generated social card and current brand icons")
