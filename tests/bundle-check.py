#!/usr/bin/env python3
"""Validate actual HTML nodes, not JavaScript template literals inside scripts."""
from pathlib import Path
from html.parser import HTMLParser
import re
import sys
root=Path(__file__).resolve().parent.parent
html=(root/'index.html').read_text();problems=[]
class BundleParser(HTMLParser):
    def __init__(self): super().__init__();self.ids=[];self.scripts=0
    def handle_starttag(self,tag,attrs):
        values=dict(attrs)
        if values.get('id'):self.ids.append(values['id'])
        if tag=='script':
            self.scripts+=1
            if values.get('src'):problems.append('external script source')
        if tag in ('img','audio','video','source','iframe') and values.get('src','').startswith(('http:','https:','//')):problems.append(f'external {tag} source')
        if tag=='link' and values.get('href','').startswith(('http:','https:','//')):problems.append('external stylesheet/font/link')
p=BundleParser();p.feed(html)
if (root/'index.html').read_bytes()!=(root/'dist/index.html').read_bytes():problems.append('index.html and dist/index.html differ')
if re.search(r'''(?:url\(\s*["']?|@import\s*["']?)(?:https?:)?//''',html,re.I):problems.append('external CSS asset')
duplicates={x for x in p.ids if p.ids.count(x)>1}
if duplicates:problems.append(f'duplicate node IDs: {sorted(duplicates)}')
if 'Planck.js 1.5.0 license' not in html or 'Permission is hereby granted' not in html:problems.append('missing embedded Planck MIT license')
if re.search(r'<!-- (VENDOR|PHYSICS|AUDIO|MUSIC|BIOMES|RULES|UI|RENDER|GAME) -->',html):problems.append('unreplaced build marker')
print(f'{p.scripts} inline scripts, {len(p.ids)} real element IDs, {len(html.encode()):,} bytes')
if problems:print('FAIL\n- '+'\n- '.join(problems));sys.exit(1)
print('PASS single-file bundle: identical copies, inline scripts, no external assets, unique node IDs, embedded license')
