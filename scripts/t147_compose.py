#!/usr/bin/env python3
"""t147 — build BEFORE/AFTER side-by-side comparison images from the
local preview screenshots (probe/t147) into download/t147_preview/.
"""
import os
from PIL import Image, ImageDraw, ImageFont

SRC = '/home/z/my-project/probe/t147'
OUT = '/home/z/my-project/download/t147_preview'
os.makedirs(OUT, exist_ok=True)

FONT = ImageFont.truetype(
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30)

JOBS = [
    # (before file, after file, out file, label, after-label)
    ('before_pc_hero_TA.png', 'after_pc_hero_TA.png',
     'compare_pc_1_hero_to_topairing.png', 'PC 1440x900 · Hero -> Top Airing', '44px'),
    ('before_pc_TA_NR.png', 'after_pc_TA_NR.png',
     'compare_pc_2_topairing_to_newreleases.png', 'PC 1440x900 · Top Airing -> New Releases', '44px'),
    ('before_pc_NR_NoR.png', 'after_pc_NR_NoR.png',
     'compare_pc_3_newreleases_to_newonruri.png', 'PC 1440x900 · New Releases -> New on Ruri', '44px'),
    ('before_mobile_NR_NoR.png', 'after_mobile_NR_NoR.png',
     'compare_mobile_newreleases_to_newonruri.png', 'Mobile 390x844 · New Releases -> New on Ruri', '36px'),
]

PAD = 16          # gutter between panels
LABEL_H = 56      # label strip above the screenshots
GAP_LINE = (255, 196, 87)  # amber marker line at the boundary row


def find_boundary_row(img, dark_bg=(13, 25, 48), tol=14):
    """Locate the section-gap row: a full-width run of near-background pixels
    (no cards/text) so we can mark where the whitespace band actually sits."""
    w, h = img.size
    px = img.load()
    # sample every 8px across; a row is "empty" when >=97% of samples are background-ish
    best_row, best_run = None, 0
    run_start = None
    for yy in range(LABEL_H, h):
        empt = 0
        total = 0
        for xx in range(4, w - 4, 8):
            r, g, b = px[xx, yy][:3]
            total += 1
            if abs(r - dark_bg[0]) <= tol and abs(g - dark_bg[1]) <= tol and abs(b - dark_bg[2]) <= tol:
                empt += 1
        if total and empt / total >= 0.97:
            if run_start is None:
                run_start = yy
        else:
            if run_start is not None:
                run = yy - run_start
                if run > best_run:
                    best_run, best_row = run, (run_start + yy) // 2
                run_start = None
    if run_start is not None:
        run = h - run_start
        if run > best_run:
            best_run, best_row = run, (run_start + h) // 2
    return best_row


def build(before_path, after_path, out_name, title, after_px='44px'):
    b = Image.open(os.path.join(SRC, before_path)).convert('RGB')
    a = Image.open(os.path.join(SRC, after_path)).convert('RGB')
    w, h = b.size
    canvas = Image.new('RGB', (w * 2 + PAD * 3, h + LABEL_H + PAD * 2), (8, 15, 30))
    draw = ImageDraw.Draw(canvas)

    # labels
    draw.text((PAD + 6, 14), 'BEFORE — 30px gap', font=FONT, fill=(160, 174, 192))
    draw.text((w + PAD * 2 + 6, 14), 'AFTER — %s gap (proposal)' % after_px,
              font=FONT, fill=(72, 187, 120))

    canvas.paste(b, (PAD, LABEL_H))
    canvas.paste(a, (w + PAD * 2, LABEL_H))

    # mark the whitespace band centre on each panel
    for img, xoff in ((b, PAD), (a, w + PAD * 2)):
        row = find_boundary_row(img)
        if row:
            yy = row + LABEL_H
            draw.line([(xoff + 2, yy), (xoff + w - 2, yy)], fill=GAP_LINE, width=2)

    # frame
    draw.rectangle([0, 0, canvas.width - 1, canvas.height - 1],
                   outline=(45, 66, 100), width=2)
    draw.text((PAD + 6, canvas.height - 40),
              title + '   ·   amber line = centre of the whitespace band',
              font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 22),
              fill=(120, 140, 170))

    canvas.save(os.path.join(OUT, out_name), optimize=True)
    print('wrote', out_name, canvas.size)


for job in JOBS:
    build(*job[:4], after_px=job[4])

print('done ->', OUT)
