#!/usr/bin/env python3
"""Build the portable single-file game, using only the Python standard library."""
from pathlib import Path
import re
import shutil

root = Path(__file__).resolve().parent
html = (root / 'src/shell.html').read_text()
# Inline order matters: physics needs Planck; game needs every other module.
modules = [('VENDOR', 'vendor/planck.min.js'), ('PHYSICS', 'src/physics.js'), ('AUDIO', 'src/audio.js'),
           ('MUSIC', 'src/music.js'), ('BIOMES', 'src/biomes.js'), ('RULES', 'src/rules.js'), ('UI', 'src/ui.js'),
           ('RENDER', 'src/render.js'), ('GAME', 'src/game.js')]
inlined = []
for marker, path in modules:
    tag = f'<!-- {marker} -->'
    if tag not in html:
        continue
    file = root / path
    if not file.exists():
        raise SystemExit(f'{tag} is in src/shell.html but {path} does not exist')
    source = file.read_text()
    # A literal script closing tag inside JS comments/strings would end an HTML script.
    source = re.sub(r'</script', r'<\\/script', source, flags=re.I)
    html = html.replace(tag, f'<script>\n{source}\n</script>')
    inlined.append(path)
license_text = (root / 'vendor/LICENSE-planck.txt').read_text()
html = html.replace('</head>', f'<!-- Planck.js 1.5.0 license:\n{license_text}\n-->\n</head>')
(root / 'index.html').write_text(html)
(root / 'dist').mkdir(exist_ok=True)
shutil.copyfile(root / 'index.html', root / 'dist/index.html')
print(f'Built index.html ({len(html.encode()):,} bytes, {len(inlined)} inline scripts: {", ".join(inlined)}); copied to dist/index.html')
