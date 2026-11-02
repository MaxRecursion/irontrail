#!/usr/bin/env python3
"""Build the portable single-file game, using only the Python standard library."""
from pathlib import Path
import re
import shutil

root = Path(__file__).resolve().parent
html = (root / 'src/shell.html').read_text()
for marker, path in [('VENDOR', 'vendor/planck.min.js'), ('PHYSICS', 'src/physics.js'), ('AUDIO', 'src/audio.js'), ('GAME', 'src/game.js')]:
    source = (root / path).read_text()
    # A literal script closing tag inside JS comments/strings would end an HTML script.
    source = re.sub(r'</script', r'<\\/script', source, flags=re.I)
    html = html.replace(f'<!-- {marker} -->', f'<script>\n{source}\n</script>')
license_text = (root / 'vendor/LICENSE-planck.txt').read_text()
html = html.replace('<!-- VENDOR -->', '')
html = html.replace('</head>', f'<!-- Planck.js 1.5.0 license:\n{license_text}\n-->\n</head>')
(root / 'index.html').write_text(html)
(root / 'dist').mkdir(exist_ok=True)
shutil.copyfile(root / 'index.html', root / 'dist/index.html')
print(f'Built index.html ({len(html.encode()):,} bytes); copied to dist/index.html')
