#!/usr/bin/env python3
"""Generate a local QA page from the real bundle; never changes the shipped game.
Uses a separate storage key, unlocks stage selection, and can start with low fuel.
"""
from pathlib import Path
import argparse
p=argparse.ArgumentParser()
p.add_argument('--stage',type=int,default=10,choices=range(1,11))
p.add_argument('--fuel',type=float,default=100)
p.add_argument('--rival-lead',type=float,default=0,help='QA-only initial lead for testing race loss')
p.add_argument('--output',default='boss-preview.html')
args=p.parse_args()
root=Path(__file__).resolve().parent.parent
html=(root/'index.html').read_text()
html=html.replace("const STORAGE_KEY = 'irontrail-campaign-v1';", "const STORAGE_KEY = 'irontrail-campaign-qa-only';")
html=html.replace('let selectedStage = campaign.selected;',f'campaign.unlocked=10; let selectedStage = {args.stage-1};')
html=html.replace('let physics = new TruckPhysics(selectedStage);',f'let physics = new TruckPhysics(selectedStage); physics.fuel={max(0,min(100,args.fuel))};')
if args.rival_lead:
    setup=f'''let physics = new TruckPhysics(selectedStage); physics.fuel={max(0,min(100,args.fuel))};'''
    moved=setup+f''' if(physics.rival){{const targetX=physics.track.startX+{args.rival_lead};const dx=targetX-physics.rival.chassis.getPosition().x;const dy=physics._heightAt(targetX)-physics._heightAt(physics.rival.chassis.getPosition().x);for(const body of [physics.rival.chassis,...physics.rival.wheels]){{const pos=body.getPosition();body.setTransform(planck.Vec2(pos.x+dx,pos.y+dy),0);}}}}'''
    html=html.replace(setup,moved)
output=root/'tests'/Path(args.output).name
output.write_text(html)
print(output)
