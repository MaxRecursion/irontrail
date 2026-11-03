const assert=require('node:assert/strict');const {ShotDirector}=require('../src/game.js');
const state={ammo:1,weapon:{canHit:true,distance:25},projectile:null,monster:{alive:true}};const d=new ShotDirector();
assert.equal(d.update(.1,state).phase,'aim');assert.ok(d.update(.1,state).timeScale<1);
for(let i=0;i<20;i++)d.update(.1,state);assert.equal(d.state.phase,'idle');assert.equal(d.update(.1,state).phase,'idle');
state.ammo=0;state.projectile={};d.shoot();for(let i=0;i<5;i++)d.update(.1,state);assert.ok(d.state.timeScale<.25);d.hit();state.monster.alive=false;state.projectile=null;assert.equal(d.update(.1,state).phase,'impact');for(let i=0;i<10;i++)d.update(.1,state);assert.equal(d.state.timeScale,1);
d.reset();state.monster.alive=true;d.shoot();for(let i=0;i<3;i++)d.update(.1,state);assert.equal(d.state.phase,'miss');for(let i=0;i<10;i++)d.update(.1,state);assert.equal(d.state.phase,'idle');d.shoot();assert.equal(d.update(.1,state,true).timeScale,1);d.reset();assert.equal(d.state.phase,'idle');assert.equal(d.aimUsed,false);console.log('PASS bounded aim/flight/impact/miss, one aim window, reduced motion and retry reset');
