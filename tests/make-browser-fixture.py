#!/usr/bin/env python3
"""Generate an isolated, deterministic QA copy of the real v3 single-file game.

Production campaign/ghost keys are replaced throughout the bundle. The generated
page seeds only QA storage and changes only its own initial world. The shared
integration harness performs normal driving through keyboard/DOM controls.
"""
from pathlib import Path
import argparse
import json

p = argparse.ArgumentParser()
p.add_argument('--stage', type=int, default=10, choices=range(1, 11))
p.add_argument('--fuel', type=float, default=100)
p.add_argument('--monster-roll', type=float, help='Deterministic monster placement in every QA attempt')
p.add_argument('--approach-monster', type=float, default=0, help='QA-only initial distance before monster')
p.add_argument('--rival-lead', type=float, default=0, help='QA-only rival start offset for loss checks')
p.add_argument('--scrap', type=int, default=600)
p.add_argument('--output', default='boss-preview.html')
args = p.parse_args()
root = Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text()
marker = '<script>\n/* IRONTRAIL v3 runtime.'
if marker not in html or "irontrail-campaign-v1" not in html:
    raise SystemExit('Build the v3 bundle with python3 build.py before generating fixtures.')
campaign_key, ghost_prefix = 'irontrail-campaign-qa-only', 'irontrail-ghost-qa-only-'
html = html.replace('irontrail-campaign-v1', campaign_key).replace('irontrail-ghost-v1-', ghost_prefix)
seed = dict(version=3, unlocked=10, selected=args.stage - 1, completed=[], best={}, stars={},
            bestScore={}, scrap=max(0, args.scrap), upgrades=dict(engine=0, tyres=0, suspension=0, tank=0))
setup = f'''\n/* Local QA fixture; production save keys are never read or written. */
try{{localStorage.setItem({json.dumps(campaign_key)},{json.dumps(json.dumps(seed))});for(let i=0;i<10;i++)localStorage.removeItem({json.dumps(ghost_prefix)}+i);}}catch(_){{}}
const QAOriginalPhysics=globalThis.TruckPhysics;let qaWorlds=0;
globalThis.TruckPhysics=class extends QAOriginalPhysics{{constructor(stage=0,options={{}}){{
  super(stage,{{...options,{f'random:()=>{max(0,min(.999999,args.monster_roll))}' if args.monster_roll is not None else ''}}});
  // v3 builds a title world, then the first run. Later retries keep normal resources.
  if(qaWorlds++<2){{
  this.fuel={max(0,min(100,args.fuel))};
'''
if args.rival_lead:
    setup += f'''  if(this.rival){{const targetX=this.track.startX+{args.rival_lead};const dx=targetX-this.rival.chassis.getPosition().x;const dy=this._heightAt(targetX)-this._heightAt(this.rival.chassis.getPosition().x);for(const body of [this.rival.chassis,...this.rival.wheels]){{const p=body.getPosition();body.setTransform(planck.Vec2(p.x+dx,p.y+dy),0);}}}}
'''
if args.approach_monster:
    setup += f'''  const targetX=this.monster.x-{args.approach_monster};const dx=targetX-this.chassis.getPosition().x;const dy=this._heightAt(targetX)+1.43-this.chassis.getPosition().y;for(const body of [this.chassis,...this.wheels]){{const p=body.getPosition();body.setTransform(planck.Vec2(p.x+dx,p.y+dy),0);}}
'''
setup += '''  this._capturePose();this.posePrev.set(this.poseCurr);
  }
}};
'''
html = html.replace(marker, '<script>' + setup + '</script>\n' + marker, 1)
output = root / 'tests' / Path(args.output).name
output.write_text(html)
print(output)
