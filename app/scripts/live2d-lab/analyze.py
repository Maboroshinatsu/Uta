"""Compare captures, including blank controls. Pixel change is evidence, not a naturalness score."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('folder', type=Path)
parser.add_argument('--baseline', type=Path)
args = parser.parse_args()
rows = json.loads((args.folder / 'results.json').read_text(encoding='utf-8'))
baseline = Image.open(args.baseline or args.folder / rows[0]['file']).convert('RGB')
report = []
for row in rows:
    shot = Image.open(args.folder / row['file']).convert('RGB')
    diff = ImageChops.difference(baseline, shot)
    # Max across channels catches colored overlays as well as displaced edges.
    mask = ImageChops.lighter(ImageChops.lighter(*diff.split()[:2]), diff.split()[2]).point(lambda v: 255 if v > 20 else 0)
    changed = mask.histogram()[255]
    requested = row['snapshot']['requested']
    actual = row['snapshot']['actual']
    report.append({'label': row['label'], 'file': row['file'], 'parameters': row['parameters'],
                   'changedPixels20': changed, 'bbox': mask.getbbox(),
                   'readback': actual, 'requested': requested,
                   'matches': all(abs(actual.get(k, float('inf')) - v) < .01 for k, v in requested.items())})
(args.folder / 'pixel-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
# Keep each sheet readable. These full-body crops match the lab's fixed 700x940 logical viewport at 125% DPI.
for start in range(0, len(rows), 18):
    group = rows[start:start+18]
    width, height, columns = 205, 395, 6
    sheet = Image.new('RGB', (columns * width, ((len(group)+columns-1)//columns) * height), '#ede9e2')
    draw = ImageDraw.Draw(sheet)
    for i, row in enumerate(group):
        shot = Image.open(args.folder / row['file']).convert('RGB').crop((175, 130, 715, 1080))
        shot.thumbnail((width-4, height-42))
        x, y = i % columns * width, i // columns * height
        sheet.paste(shot, (x, y+40))
        draw.text((x+3, y+3), row['label'][:31], fill='black')
        draw.text((x+3, y+19), f"pixels>20: {report[start+i]['changedPixels20']}", fill='black')
    sheet.save(args.folder / f'contact-{start//18:02d}.png')
print(json.dumps([{'label': r['label'], 'pixels': r['changedPixels20'], 'matches': r['matches']} for r in report]))
