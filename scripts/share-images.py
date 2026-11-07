"""Share images for Cookie's Cards, built from the game's own felt and card art.

    python scripts/share-images.py

Writes
  public/og-cards.jpg            the 1200x630 link preview (iMessage, WhatsApp, Slack, Facebook)
  public/email/birthday.jpg      the 900-wide card for the birthday email, button baked in
  public/email/birthday.html     open it, Ctrl+A, Ctrl+C, paste into Gmail: the image, already
                                 linked to the site (same trick as the FFL recap emails)

Needs Chrome and Pillow. The button lives inside the image because a pasted HTML button does not
survive Gmail; the whole image is the link instead.
"""
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
IMG = (PUBLIC / "assets" / "images").as_uri()
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
SITE = "https://cookies-cards.netlify.app"

FELT = "radial-gradient(ellipse 130% 105% at 50% 26%, #1e7a4d, #08301e 76%), #08301e"

BASE_CSS = """
* { margin: 0; box-sizing: border-box; }
html, body { overflow: hidden; }
body {
    position: relative;
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    color: #f6f0e4;
    background: __FELT__;
    -webkit-font-smoothing: antialiased;
}
/* Four cards fanned from a point below their bottom edge, the Cookie back in front. */
.fan { position: absolute; }
.fan img {
    position: absolute;
    left: 50%;
    bottom: 0;
    width: var(--cw);
    aspect-ratio: 11 / 16;
    margin-left: calc(var(--cw) / -2);
    object-fit: cover;
    background: #fff;
    border-radius: 5.5%;
    box-shadow: 0 10px 22px rgba(0, 0, 0, 0.45), 0 2px 4px rgba(0, 0, 0, 0.3);
    transform-origin: 50% 118%;
}
.fan .c1 { transform: rotate(-28deg); }
.fan .c2 { transform: rotate(-9.5deg); }
.fan .c3 { transform: rotate(9.5deg); }
.fan .c4 { transform: rotate(28deg); }
.serif { font-family: Georgia, 'Times New Roman', serif; }
"""

FAN = f"""
<div class="fan">
  <img class="c1" src="{IMG}/Card%20Faces/ace_of_spades2.png">
  <img class="c2" src="{IMG}/Card%20Faces/king_of_hearts2.png">
  <img class="c3" src="{IMG}/Card%20Faces/queen_of_diamonds2.png">
  <img class="c4" src="{IMG}/card_back_cookie.jpg">
</div>
"""

OG_CSS = """
body { width: 1200px; height: 630px; }
.text { position: absolute; left: 78px; top: 96px; }
.cookie { font-size: 62px; line-height: 1; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.45)); }
h1 { margin-top: 18px; font-size: 92px; line-height: 1.02; font-weight: 700; letter-spacing: 0.3px; }
h1 .gold { color: #ffd977; text-shadow: 0 3px 14px rgba(0,0,0,0.5); }
h1 .cream { color: #f6f0e4; text-shadow: 0 3px 14px rgba(0,0,0,0.45); }
.rule { width: 130px; height: 3px; margin: 26px 0 28px; background: linear-gradient(90deg, #ffd977, rgba(255,217,119,0)); }
.tag { font-size: 29px; line-height: 1.38; color: #f3e6c8; opacity: 0.9; }
.fan { --cw: 290px; left: 540px; width: 620px; bottom: 54px; height: 420px; }
"""

OG_HTML = f"""
<body>
  <div class="text">
    <div class="cookie">🍪</div>
    <h1 class="serif"><span class="gold">Cookie’s</span><br><span class="cream">Cards</span></h1>
    <div class="rule"></div>
    <p class="tag">Solitaire, Canasta, Kalooki and<br>Tile Rummy, made for Cookie.</p>
  </div>
  {FAN}
</body>
"""

MAIL_W, MAIL_H = 900, 900

MAIL_CSS = f"""
body {{ width: {MAIL_W}px; height: {MAIL_H}px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; }}
.panel {{
    position: relative;
    width: 800px;
    /* Room for the fan: its top, a 140px card (204px tall), the drop of the rotated corners, a gap. */
    padding: 292px 40px 44px;
    text-align: center;
    color: #2c2216;
    background: linear-gradient(180deg, #fffaf0, #f6e9d2);
    border: 1px solid rgba(255, 255, 255, 0.8);
    border-radius: 26px;
    box-shadow: 0 22px 50px rgba(0, 0, 0, 0.4), 0 0 0 6px rgba(255, 217, 119, 0.22);
}}
.panel .fan {{ --cw: 140px; left: 50%; top: 24px; width: 0; height: 204px; }}
h1 {{ font-size: 56px; line-height: 1.1; font-weight: 700; color: #8a5a12; }}
.lead {{ margin-top: 10px; font-size: 24px; color: #2c2216; opacity: 0.78; }}
.games {{ display: flex; justify-content: center; gap: 12px; margin-top: 26px; }}
.games i {{ font-style: normal; font-size: 27px; vertical-align: -3px; margin-right: 4px; }}
.games span {{
    padding: 10px 16px;
    font-size: 22px;
    color: #8a5a12;
    background: #fff;
    border: 1px solid #e6d7b8;
    border-radius: 999px;
    white-space: nowrap;
}}
.btn {{
    display: inline-flex;
    align-items: center;
    gap: 18px;
    margin-top: 34px;
    padding: 20px 62px 22px;
    font-size: 44px;
    font-weight: 700;
    color: #34240a;
    background: linear-gradient(180deg, #ffdc8a, #f0b23f);
    border: 2px solid rgba(255, 255, 255, 0.6);
    border-radius: 20px;
    box-shadow: 0 4px 0 rgba(120, 74, 8, 0.5), 0 12px 26px rgba(240, 178, 63, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.6);
}}
.sub {{ margin-top: 26px; font-size: 20px; line-height: 1.4; color: #2c2216; opacity: 0.72; }}
.foot {{ font-size: 18px; color: #f3e6c8; opacity: 0.8; }}
.foot b {{ font-weight: 600; color: #ffd977; }}
"""

TRIANGLE = ('<svg width="34" height="38" viewBox="0 0 30 34" aria-hidden="true">'
            '<path d="M3 3 L27 17 L3 31 Z" fill="#34240a" stroke="#34240a" stroke-width="4" stroke-linejoin="round"/></svg>')

MAIL_HTML = f"""
<body>
  <div class="panel">
    {FAN}
    <h1 class="serif">Happy birthday, Cookie!</h1>
    <p class="lead">There are new games on the table, just for you.</p>
    <div class="games serif">
      <span><i>♠️</i>Solitaire</span><span><i>🃏</i>Canasta</span><span><i>🎴</i>Kalooki</span><span><i>🀄</i>Tile Rummy</span>
    </div>
    <div class="btn serif">{TRIANGLE}Play now</div>
    <p class="sub">Tap the button to sit down at the table. It works on your phone, your tablet or<br>
    your computer, and there is nothing to install.</p>
  </div>
  <div class="foot">Made for Cookie, with love. &nbsp;·&nbsp; <b>cookies-cards.netlify.app</b></div>
</body>
"""


def shoot(css, body, png, width, height, scale=2):
    """Render the page with headless Chrome at 2x so text and card edges stay crisp after the resize."""
    markup = f'<!doctype html><html lang="en"><meta charset="utf-8"><style>{BASE_CSS.replace("__FELT__", FELT)}{css}</style>{body}</html>'
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "page.html"
        src.write_text(markup, encoding="utf-8")
        subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
             f"--user-data-dir={Path(tmp) / 'profile'}", f"--force-device-scale-factor={scale}",
             f"--window-size={width},{height}", "--virtual-time-budget=10000",
             f"--screenshot={png}", src.as_uri()],
            check=True, capture_output=True, timeout=120)


def save_jpeg(png, dest, width, max_kb):
    """Downscale to the final width and step the quality down until the file fits the cap."""
    img = Image.open(png).convert("RGB")
    if img.width != width:
        img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    for quality in (90, 86, 82, 78, 74, 70):
        img.save(dest, "JPEG", quality=quality, optimize=True)
        if dest.stat().st_size <= max_kb * 1024:
            break
    return img.size, dest.stat().st_size // 1024


def paste_page(jpg, dest, size):
    """The Ctrl+A, Ctrl+C page: just the image, linked to the site, with absolute URLs."""
    w, h = size
    dest.write_text(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow">'
        "<title>Cookie's birthday card: Ctrl+A, Ctrl+C, then paste into Gmail</title></head>"
        f'<body style="margin:0;background:#ffffff"><a href="{SITE}/"><img src="{SITE}/email/{jpg.name}" '
        f'width="{w}" height="{h}" alt="Happy birthday, Cookie! New card games on the table, made for you. '
        'Click here to play." style="display:block;max-width:100%;height:auto;border:0"></a></body></html>',
        encoding="utf-8")


def main():
    work = Path(tempfile.mkdtemp())
    og = PUBLIC / "og-cards.jpg"
    shoot(OG_CSS, OG_HTML, work / "og.png", 1200, 630)
    size, kb = save_jpeg(work / "og.png", og, 1200, 290)   # WhatsApp caps preview images at 300KB
    print(f"{og.relative_to(ROOT)}  {size[0]}x{size[1]}  {kb}KB")

    mail_dir = PUBLIC / "email"
    mail_dir.mkdir(exist_ok=True)
    jpg = mail_dir / "birthday.jpg"
    shoot(MAIL_CSS, MAIL_HTML, work / "mail.png", MAIL_W, MAIL_H)
    size, kb = save_jpeg(work / "mail.png", jpg, MAIL_W, 250)
    print(f"{jpg.relative_to(ROOT)}  {size[0]}x{size[1]}  {kb}KB")
    paste_page(jpg, mail_dir / "birthday.html", size)
    print(f"{(mail_dir / 'birthday.html').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
