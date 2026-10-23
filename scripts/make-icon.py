"""Generate the application icon.

The mark is a rounded square in the accent colour with the character "词" in
it, matching the sidebar badge in the interface.

Run with:
    python scripts/make-icon.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src-tauri" / "icons"

ACCENT = (58, 64, 72, 255)
WHITE = (255, 255, 255, 255)

SIZES = [32, 128, 256, 512]


def font_for(size: int) -> ImageFont.FreeTypeFont:
    """Find a font that can render Chinese at the requested size."""
    candidates = [
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/msyhbd.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc",
    ]
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def draw_mark(size: int) -> Image.Image:
    """Render the icon at one size."""
    # Draw at 4x and downsample so the edges stay smooth.
    scale = 4
    canvas = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    side = size * scale
    radius = int(side * 0.22)
    margin = int(side * 0.04)
    draw.rounded_rectangle(
        (margin, margin, side - margin, side - margin),
        radius=radius,
        fill=ACCENT,
    )

    font = font_for(int(side * 0.56))
    text = "词"
    box = draw.textbbox((0, 0), text, font=font)
    text_width = box[2] - box[0]
    text_height = box[3] - box[1]
    x = (side - text_width) / 2 - box[0]
    y = (side - text_height) / 2 - box[1]
    draw.text((x, y), text, font=font, fill=WHITE)

    return canvas.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    for size in SIZES:
        image = draw_mark(size)
        image.save(OUT / f"{size}x{size}.png")
        print(f"wrote {size}x{size}.png")

    # The Windows installer wants an .ico with several sizes inside.
    base = draw_mark(256)
    base.save(
        OUT / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("wrote icon.ico")


if __name__ == "__main__":
    main()
