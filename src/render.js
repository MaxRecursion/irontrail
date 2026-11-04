/* IRONTRAIL v3 canvas renderer. No DOM/layout reads in render(), no runtime textures.
 * World art is cached vertically inverted, so sprites and filled Path2Ds share
 * one +Y-up transform. Sprite banks at 100/90/80% cover camera zoom without JIT baking.
 */
(function (global) {
  'use strict';
  const TAU = Math.PI * 2, EMPTY = Object.freeze({}), MAX_PARTICLES = 600, PS = 10, POPUPS = 16;
  const PLAYER = 0, RIVAL = 3, PROJECTILE = 6, ZOMBIES = 7;
  const clamp = (v,a,b) => Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
  const finite = (v,fallback=0) => Number.isFinite(v)?v:fallback;
  const hash = n => { const x=Math.sin(n*127.1+311.7)*43758.5453; return x-Math.floor(x); };
  const wrap = n => Math.atan2(Math.sin(n),Math.cos(n));
  const poly = (c,points,fill,stroke,width=.06) => {
    c.beginPath(); c.moveTo(points[0][0],points[0][1]);
    for(let i=1;i<points.length;i++)c.lineTo(points[i][0],points[i][1]);
    c.closePath();if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.lineJoin='round';c.stroke();}
  };
  const circle = (c,x,y,r,fill,stroke,width=.04) => {c.beginPath();c.arc(x,y,r,0,TAU);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}};
  const line = (c,x1,y1,x2,y2,color,width=.05) => {c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.stroke();};
  function makeCanvas(width,height){
    const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(Math.max(1,width|0),Math.max(1,height|0)):global.document.createElement('canvas');
    canvas.width=Math.max(1,width|0);canvas.height=Math.max(1,height|0);return canvas;
  }
  class IronRenderer {
    constructor(canvas,options=EMPTY){
      if(!canvas||!canvas.getContext)throw new TypeError('IronRenderer needs a canvas');
      this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.biomes=options.biomes||global.IRON_BIOMES;
      this.width=960;this.height=540;this.renderScale=1;this.particleScale=1;this.detail='high';this._detail=2;
      this._physics=null;this._track=null;this._stageIndex=-1;this._biome=null;this._chunks=[];this._gaps=[];this._props=[];this._signs=[];this._flags=[];
      this._banks=[];this._bank=null;this._spriteBytes=0;this._screenBytes=0;this._baseScale=32;this._cachePPU=0;
      this._cameraX=0;this._cameraY=0;this._cameraScale=32;this._cameraVX=0;this._cameraVY=0;this._snap=true;
      this._ox=0;this._oy=0;this._left=0;this._right=0;this._top=0;this._bottom=0;
      this._clock=0;this._worldClock=0;this._trauma=0;this._zoomPunch=0;this._kick=0;this._muzzle=0;this._flashTime=0;this._flashDuration=1;this._flashColor='#fff2c4';
      this._impactTime=0;this._impactX=0;this._impactY=0;this._focus=0;this._worldDetail=2;
      this._particles=new Float32Array(MAX_PARTICLES*PS);this._particleHead=0;this._particleCount=0;
      this._popupData=new Float32Array(POPUPS*5);this._popupText=new Array(POPUPS).fill('');this._popupHead=0;
      this._fallbackPose=new Float64Array(64);this._scratch=new Float64Array(3);this._screenPoint=new Float64Array(2);
      this._particleSprites=[];this._dustClock=0;this._exhaustClock=0;this._weatherClock=0;this._pose=null;this._state=EMPTY;this._input=EMPTY;this._frame=EMPTY;
      this._stats={drawOps:0,particles:0,renderMs:0,spriteBytes:0,renderScale:1};
      const self=this;this._cameraSnapshot=Object.freeze({get x(){return self._cameraX;},get y(){return self._cameraY;},get scale(){return self._cameraScale;}});
      this.resize(960,540);
    }
    get camera(){return this._cameraSnapshot;}
    get stats(){return this._stats;}
    setStage(physics,stageIndex=0){
      if(!physics||!physics.track)return;
      const index=clamp(Math.floor(stageIndex),0,9),sameTrack=this._track===physics.track,sameBiome=index===this._stageIndex;
      this._physics=physics;this._track=physics.track;this._stageIndex=index;this._biome=this.biomes[index]||this.biomes[0];
      if(!sameTrack)this._buildTerrain();
      if(!sameTrack||!sameBiome)this._buildLayout();
      if(!sameBiome||!this._banks.length)this._buildAssets();
      const length=Math.max(21,finite(physics.poseLength,3*(7+(physics.zombies?physics.zombies.length:0))));
      if(this._fallbackPose.length<length)this._fallbackPose=new Float64Array(length);
      this._particles.fill(0);this._popupData.fill(0);this._particleCount=0;this._dustClock=0;this._exhaustClock=0;this._weatherClock=0;
      this._kick=0;this._muzzle=0;this._trauma=0;this._clock=0;this._worldClock=0;this._impactTime=0;this._focus=0;this.snapCamera();
    }
    resize(cssWidth,cssHeight){
      this.width=Math.max(1,finite(cssWidth,960));this.height=Math.max(1,finite(cssHeight,540));
      this._baseScale=clamp(this.width/30,20,54);this._resizeBacking();
      if(this._biome)this._buildAssets();
      this._snap=true;
    }
    _resizeBacking(){
      const w=Math.max(1,Math.round(this.width*this.renderScale)),h=Math.max(1,Math.round(this.height*this.renderScale));
      if(this.canvas.width!==w)this.canvas.width=w;if(this.canvas.height!==h)this.canvas.height=h;
      if(this._biome)this._buildScreenGradients();
    }
    setQuality(quality=EMPTY){
      const previous=this.renderScale;
      if(Number.isFinite(quality.renderScale))this.renderScale=clamp(quality.renderScale,.5,3);
      if(Number.isFinite(quality.particleScale))this.particleScale=clamp(quality.particleScale,0,1);
      if(quality.detail==='high'||quality.detail==='medium'||quality.detail==='low')this.detail=quality.detail;
      this._detail=this.detail==='high'?2:this.detail==='medium'?1:0;
      // Adaptive quality only changes the primary backing store. Existing higher
      // resolution textures are reused; no large offscreen allocation happens.
      if(previous!==this.renderScale)this._resizeBacking();
      this._stats.renderScale=this.renderScale;
    }
    snapCamera(){this._snap=true;this._cameraVX=0;this._cameraVY=0;}
    addTrauma(amount){this._trauma=clamp(this._trauma+finite(amount),0,1);}
    flash(color='#fff2c4',seconds=.12){this._flashColor=color;this._flashTime=clamp(seconds,0,2);this._flashDuration=Math.max(.001,this._flashTime);}
    worldToScreen(x,y,out){
      const result=out||{};const px=x*this._cameraScale+this._ox,py=-y*this._cameraScale+this._oy;
      if(ArrayBuffer.isView(result)||Array.isArray(result)){result[0]=px;result[1]=py;}else{result.x=px;result.y=py;}
      return result;
    }
    _heightAt(x){
      const segments=this._track.segments;
      let lo=0,hi=segments.length-1,segment=null;
      while(lo<=hi){const m=(lo+hi)>>1,s=segments[m];if(x<s[0].x)hi=m-1;else if(x>s[s.length-1].x)lo=m+1;else{segment=s;break;}}
      if(!segment)return 0;
      lo=1;hi=segment.length-1;
      while(lo<hi){const m=(lo+hi)>>1;if(segment[m].x<x)lo=m+1;else hi=m;}
      const a=segment[Math.max(0,lo-1)],b=segment[lo];return a.y+(b.y-a.y)*(x-a.x)/Math.max(.0001,b.x-a.x);
    }
    _ribbon(points,offset,width,wave=0){
      const path=new Path2D();
      for(let i=0;i<points.length;i++){const p=points[i],y=p.y-offset+Math.sin(p.x*.47+offset)*wave;if(i)path.lineTo(p.x,y);else path.moveTo(p.x,y);}
      for(let i=points.length-1;i>=0;i--){const p=points[i];path.lineTo(p.x,p.y-offset-width+Math.sin(p.x*.47+offset)*wave);}
      path.closePath();return path;
    }
    _buildTerrain(){
      this._chunks=[];this._gaps=[];const segments=this._track.segments;
      for(let s=0;s<segments.length;s++){
        const segment=segments[s];if(segment.length<2)continue;
        let begin=0;
        while(begin<segment.length-1){
          let end=begin+1;while(end<segment.length-1&&segment[end].x-segment[begin].x<30)end++;
          const points=segment.slice(begin,end+1),first=points[0],last=points[points.length-1],body=new Path2D();
          body.moveTo(first.x,first.y);let maxY=first.y;
          for(let i=1;i<points.length;i++){body.lineTo(points[i].x,points[i].y);maxY=Math.max(maxY,points[i].y);}
          body.lineTo(last.x,-80);body.lineTo(first.x,-80);body.closePath();
          const bands=[];for(let i=0;i<4;i++)bands.push(this._ribbon(points,.45+i*.85,.3+i*.03,.08));
          const specks=[new Path2D(),new Path2D()],grass=new Path2D();
          for(let n=Math.ceil(first.x*3);n<last.x*3;n++){
            const x=n/3+hash(n+17)*.2,y=this._heightAt(x)-.25-hash(n+23)*6,size=.025+hash(n+29)*.045;
            specks[n&1].rect(x,y,size*1.5,size);
          }
          for(let n=Math.ceil(first.x*1.5);n<last.x*1.5;n++){
            if(hash(n+71)<.44)continue;const x=n/1.5,y=this._heightAt(x),h=.055+hash(n+72)*.12;
            grass.moveTo(x-.05,y-.01);grass.lineTo(x-.08,y+h);grass.lineTo(x,y+.025);grass.lineTo(x+.045,y+h*1.3);grass.lineTo(x+.055,y-.01);grass.closePath();
          }
          this._chunks.push({left:first.x,right:last.x,maxY,body,bands,specks,grass,top:this._ribbon(points,0,.17),rim:this._ribbon(points,-.035,.055)});
          begin=end;
        }
        if(s<segments.length-1){
          const a=segment[segment.length-1],b=segments[s+1][0],left=new Path2D(),right=new Path2D();
          if(b.x>a.x+.05){
            left.moveTo(a.x-.5,a.y);left.lineTo(a.x,a.y);left.lineTo(a.x+.2,-80);left.lineTo(a.x-.85,-80);left.closePath();
            right.moveTo(b.x,b.y);right.lineTo(b.x+.55,b.y);right.lineTo(b.x+1.05,-80);right.lineTo(b.x-.2,-80);right.closePath();
            this._gaps.push({left:a.x-.1,right:b.x+.1,top:Math.max(a.y,b.y),leftFace:left,rightFace:right});
          }
        }
      }
    }
    _buildLayout(){
      this._props=[];this._signs=[];this._flags=[];const biome=this._biome,track=this._track;
      let totalWeight=0;for(let i=0;i<biome.props.length;i++)totalWeight+=biome.props[i].weight;
      const spacing=4.8/biome.propDensity;
      for(let x=-25,i=0;x<track.finishX+20;x+=spacing,i++){
        const px=x+hash(i+831)*spacing*.7;let onTrack=false;
        for(let j=0;j<track.segments.length;j++){const s=track.segments[j];if(px>s[0].x+1&&px<s[s.length-1].x-1){onTrack=true;break;}}
        if(!onTrack)continue;let pick=hash(i+197)*totalWeight,kind=biome.props[0].kind;
        for(let j=0;j<biome.props.length;j++){pick-=biome.props[j].weight;if(pick<=0){kind=biome.props[j].kind;break;}}
        this._props.push({x:px,y:this._heightAt(px),kind,scale:.7+hash(i+191)*.6,flip:hash(i+198)>.5?-1:1,detail:i%3});
      }
      for(let d=50;d<track.length;d+=100){const x=track.startX+d;this._signs.push({x,y:this._heightAt(x),label:String(d)+' M',jump:false});}
      for(let i=0;i<track.segments.length-1;i++){const s=track.segments[i],x=s[s.length-1].x-5;this._signs.push({x,y:this._heightAt(x),label:'JUMP',jump:true});}
      for(let i=0;i<track.checkpoints.length;i++){const cp=track.checkpoints[i];this._flags.push({x:cp.x,y:finite(cp.y,this._heightAt(cp.x)),index:i});}
    }
    _worldSprite(ppu,left,bottom,w,h,draw){
      const canvas=makeCanvas(Math.ceil(w*ppu),Math.ceil(h*ppu)),c=canvas.getContext('2d');
      c.setTransform(ppu,0,0,ppu,-left*ppu,-bottom*ppu);draw(c);
      this._spriteBytes+=canvas.width*canvas.height*4;return {canvas,left,bottom,w,h};
    }
    _bakedText(c,text,x,y,size,color,weight='700'){
      c.save();c.translate(x,y);c.scale(1,-1);c.fillStyle=color;c.textAlign='center';c.font=weight+' '+size+'px Arial';c.fillText(text,0,0);c.restore();
    }
    _buildAssets(){
      this._spriteBytes=0;this._screenBytes=0;this._banks=[];const ppu=clamp(this._baseScale*this.renderScale,24,108);this._cachePPU=ppu;
      for(let i=0;i<3;i++)this._banks.push(this._buildSpriteBank(ppu*(1-i*.1)));
      this._bank=this._banks[0];this._buildBackground();this._buildScreenGradients();
      this._stats.spriteBytes=this._spriteBytes+this._screenBytes;
    }
    _buildSpriteBank(ppu){
      const b=this._biome,o=b.outline||'#14262d',bank={ppu,props:{},signs:{},flags:[]};
      bank.player=this._worldSprite(ppu,-2.55,-.56,5.1,2.35,c=>this._paintTruck(c,false));
      bank.rival=this._worldSprite(ppu,-2.65,-.56,5.3,2.55,c=>this._paintTruck(c,true));
      bank.wheels=[];for(let rival=0;rival<2;rival++)for(let blur=0;blur<2;blur++)bank.wheels.push(this._worldSprite(ppu,-.82,-.82,1.64,1.64,c=>this._paintWheel(c,!!rival,!!blur)));
      bank.cannon=this._worldSprite(ppu,-.4,-.37,2.1,.76,c=>{
        poly(c,[[-.31,-.2],[.5,-.2],[.63,.17],[-.25,.17]],'#334941',o);
        poly(c,[[.4,-.11],[1.45,-.11],[1.45,.11],[.4,.11]],'#789287',o);
        poly(c,[[1.18,-.16],[1.5,-.16],[1.5,.16],[1.18,.16]],'#253c36',o);
        line(c,.79,-.1,.79,.1,'#d0d8b3',.07);circle(c,-.05,0,.15,'#4c6550',o);circle(c,-.05,0,.045,'#dce6ab');
      });
      bank.fuel=this._worldSprite(ppu,-1.2,-1.1,2.4,2.5,c=>{
        const g=c.createRadialGradient(0,0,.1,0,0,1.08);g.addColorStop(0,'#f6cc6659');g.addColorStop(1,'#f6cc6600');c.fillStyle=g;c.fillRect(-1.2,-1.1,2.4,2.5);
        poly(c,[[-.34,-.42],[.35,-.42],[.35,.22],[.13,.43],[-.34,.43]],'#dfae4c',o,.065);
        line(c,-.17,.44,-.17,.58,o,.075);line(c,-.17,.58,.12,.58,o,.075);line(c,.12,.58,.12,.44,o,.075);
        poly(c,[[.17,.42],[.38,.32],[.42,.44],[.24,.54]],'#566947',o,.03);
        line(c,-.2,-.22,.2,.2,'#ae773c',.035);line(c,.2,-.22,-.2,.2,'#ae773c',.035);
        poly(c,[[.02,.25],[-.12,-.01],[.02,-.01],[-.04,-.25],[.18,.07],[.04,.07]],'#fff0b3');this._bakedText(c,'+32',0,.8,.23,'#eee0ad');
      });
      bank.zombies=[];for(let v=0;v<3;v++)for(let f=0;f<2;f++)bank.zombies.push(this._worldSprite(Math.min(ppu,78),-.82,-.8,1.64,2.05,c=>this._paintZombie(c,v,f)));
      bank.monster=this._worldSprite(ppu,-2.05,-.12,4.1,5.5,c=>this._paintMonster(c));
      bank.target=this._worldSprite(ppu,-.7,-.7,1.4,1.4,c=>{
        circle(c,0,0,.49,null,'#e7eeb1',.025);for(let i=0;i<4;i++){const a=i*Math.PI/2;line(c,Math.cos(a)*.39,Math.sin(a)*.39,Math.cos(a)*.65,Math.sin(a)*.65,'#edf3c8',.035);}
      });
      bank.projectile=this._worldSprite(ppu,-.85,-.22,1.05,.44,c=>{
        const g=c.createRadialGradient(0,0,.01,0,0,.22);g.addColorStop(0,'#fff7cb');g.addColorStop(.35,'#efcb78bb');g.addColorStop(1,'#efcb7800');c.fillStyle=g;c.fillRect(-.3,-.22,.52,.44);poly(c,[[-.85,-.035],[.08,-.055],[.16,0],[.08,.055],[-.85,.035]],'#f8e5a7');
      });
      bank.flash=this._worldSprite(ppu,-.1,-.5,1.65,1,c=>{poly(c,[[0,-.18],[.85,-.43],[.58,-.09],[1.5,0],[.62,.12],[.82,.43],[0,.19]],'#f6da86');poly(c,[[0,-.08],[.55,0],[0,.08]],'#fff7d0');});
      bank.shadow=this._worldSprite(Math.min(ppu,60),-2.6,-.3,5.2,.6,c=>{
        const g=c.createRadialGradient(0,0,.05,0,0,2.5);g.addColorStop(0,'#102a30a3');g.addColorStop(1,'#102a3000');c.save();c.scale(1,.11);c.fillStyle=g;c.fillRect(-2.6,-2.6,5.2,5.2);c.restore();
      });
      bank.headlight=this._worldSprite(Math.min(ppu,60),0,-2.1,9.5,4.2,c=>{
        const g=c.createLinearGradient(0,0,9.5,0);g.addColorStop(0,'#fff0a643');g.addColorStop(1,'#fff0a600');poly(c,[[0,-.08],[9.5,-2.1],[9.5,1.1],[0,.08]],g);
      });
      bank.brake=this._worldSprite(Math.min(ppu,60),-.35,-.35,.7,.7,c=>{const g=c.createRadialGradient(0,0,.02,0,0,.35);g.addColorStop(0,'#ffb07d');g.addColorStop(.25,'#ed614ecf');g.addColorStop(1,'#ed614e00');c.fillStyle=g;c.fillRect(-.35,-.35,.7,.7);});
      const kinds=['cactus','rock','deadTree','tombstone','cross','bones','wreck','drum','fence','ruin','lamp','chimney','pine'];
      for(let i=0;i<kinds.length;i++){const kind=kinds[i];bank.props[kind]=this._worldSprite(Math.min(ppu,60),-1.8,-.08,3.6,4.45,c=>this._paintProp(c,kind));}
      for(let i=0;i<this._signs.length;i++){const sign=this._signs[i];if(!bank.signs[sign.label])bank.signs[sign.label]=this._worldSprite(ppu,-.8,-.05,1.6,2.5,c=>this._paintSign(c,sign.label));}
      for(let i=0;i<this._flags.length;i++)for(let passed=0;passed<2;passed++)bank.flags.push(this._worldSprite(ppu,-.12,-.05,1.45,3.6,c=>{
        line(c,0,0,0,3.4,'#425d54',.065);poly(c,[[0,3.35],[1.15,3.2],[.95,2.62],[0,2.77]],passed?b.accent:'#8d9c8d',o,.045);this._bakedText(c,i?String(i).padStart(2,'0'):'GO',.47,2.92,.25,o);
      }));
      bank.finish=this._worldSprite(ppu,-2,-.1,4,5.75,c=>{
        line(c,-1.7,0,-1.7,5.5,o,.13);line(c,1.7,0,1.7,5.5,o,.13);poly(c,[[-1.83,4.65],[1.83,4.65],[1.83,5.55],[-1.83,5.55]],o);
        for(let i=0;i<16;i++)for(let j=0;j<2;j++){c.fillStyle=(i+j)%2?'#344f47':'#e3e5c4';c.fillRect(-1.76+i*.22,5.05+j*.2,.22,.2);}this._bakedText(c,'FINISH',0,4.8,.29,'#e8edcc');
      });
      return bank;
    }
    _paintTruck(c,rival){
      const b=this._biome,o=b.outline,paint=rival?'#ac4836':b.truckPaint,trim=rival?'#e29a66':'#edbf62',dark='#243b38';
      poly(c,[[-2.25,-.39],[2.28,-.39],[2.28,-.17],[-2.25,-.17]],dark,o,.08);
      poly(c,[[-2.18,-.1],[-2.16,.5],[-1.12,.5],[-.83,1.26],[.55,1.26],[1.14,.5],[1.91,.39],[2.2,.15],[2.2,-.15],[1.9,-.3],[-1.92,-.3]],paint,o,.085);
      poly(c,[[-2.13,.35],[-1.08,.35],[-1.08,.51],[-2.13,.51]],'#465746',o,.03);
      poly(c,[[-1.05,.51],[-.76,1.18],[.5,1.18],[1.02,.51]],dark,o,.06);
      poly(c,[[-.8,.59],[-.66,1.08],[-.1,1.08],[-.1,.59]],'#80adae',o,.045);
      poly(c,[[.03,.59],[.03,1.08],[.43,1.08],[.84,.59]],'#6c989e',o,.045);
      poly(c,[[-.59,.67],[-.51,1.02],[-.25,1.02]],'#c0d6c5');
      poly(c,[[.11,.67],[.11,1.02],[.39,1.02],[.5,.85]],'#b1ccc0');
      poly(c,[[-.9,1.22],[.62,1.22],[.65,1.36],[-.87,1.36]],dark,o,.04);
      // Amber rescue stripe stays recognizable through every stage palette.
      poly(c,[[-2.1,.07],[1.93,.07],[2.1,.21],[1.08,.29],[-2.1,.29]],trim,o,.026);
      poly(c,[[-.88,-.15],[.97,-.15],[.97,.07],[-.88,.07]],paint);
      line(c,-.08,-.21,-.08,.48,o,.025);line(c,-.92,-.19,-.92,.49,o,.025);
      poly(c,[[1.07,.49],[1.91,.37],[2.12,.22],[1.13,.29]],trim,o,.03);
      poly(c,[[1.99,-.13],[2.38,-.13],[2.38,.08],[2.08,.08]],dark,o,.055);
      poly(c,[[-2.38,-.18],[-1.99,-.18],[-1.99,.04],[-2.38,.04]],dark,o,.055);
      poly(c,[[1.97,.1],[2.12,.1],[2.12,.23],[1.97,.26]],'#fff0be',o,.03);
      poly(c,[[-2.18,.1],[-2.05,.1],[-2.05,.3],[-2.18,.3]],'#d86c45',o,.03);
      poly(c,[[-2.02,-.18],[-1.94,.04],[-1.73,.23],[-1.43,.23],[-1.18,.02],[-1.12,-.18]],dark,o,.045);
      poly(c,[[1.07,-.18],[1.18,.03],[1.39,.23],[1.72,.23],[1.96,.02],[2.01,-.18]],dark,o,.045);
      line(c,-1.29,.51,-1.29,1.16,'#304840',.13);line(c,-1.29,1.16,-1.44,1.24,'#304840',.13);line(c,-1.3,.58,-1.3,1.08,'#a9b4a0',.035);
      poly(c,[[-.98,.58],[-1.18,.65],[-1.18,.79],[-.93,.74]],dark,o,.035);
      line(c,-.61,.4,-.37,.4,'#d7d8b0',.035);line(c,.23,.4,.47,.4,'#d7d8b0',.035);
      this._bakedText(c,rival?'MAW':'IRON',.46,-.12,.29,rival?'#f3d3a0':'#f7e2aa','900');
      this._bakedText(c,rival?'WARLORD':'TRAILBREAKER',-.47,-.1,.115,'#dce0bb');
      if(rival){for(let i=0;i<4;i++)poly(c,[[-.76+i*.35,1.35],[-.6+i*.35,1.72],[-.46+i*.35,1.35]],'#b77757',o,.045);for(let i=0;i<3;i++)poly(c,[[2.13,-.13+i*.12],[2.52,-.02+i*.12],[2.13,.04+i*.12]],'#b06a4a',o,.04);}
      else {poly(c,[[-1.94,.51],[-1.79,.78],[-1.62,.51]],trim,o,.035);circle(c,-1.79,.68,.055,'#f9e6af');}
    }
    _paintWheel(c,rival,blur){
      const o=this._biome.outline;
      circle(c,0,0,.77,'#172b2c',o,.065);circle(c,0,0,.66,'#263d3b');circle(c,0,0,.54,'#13272b');
      if(blur){circle(c,0,0,.69,null,'#5a6c5b',.095);circle(c,0,0,.61,null,'#8b9978',.025);}
      else for(let i=0;i<18;i++){c.save();c.rotate(i*TAU/18);poly(c,[[-.11,.62],[.08,.66],[.1,.75],[-.13,.73]],i%2?'#61715b':'#4a6050',null);c.restore();}
      circle(c,0,0,.42,rival?'#bd7954':'#a8b68c',o,.055);circle(c,0,0,.31,rival?'#dfaa73':'#d2d8aa');
      for(let i=0;i<6;i++){const a=i*TAU/6;circle(c,Math.cos(a)*.235,Math.sin(a)*.235,.055,'#334e43');}
      circle(c,0,0,.115,'#4b6650',o,.025);circle(c,0,0,.045,'#eef0c8');
    }
    _paintZombie(c,variant,frame){
      const o=this._biome.outline,coat=['#557b71','#9b7b54','#738151'][variant],skin=['#a3ba85','#b6bd8b','#8faf94'][variant],gait=frame?.09:-.09;
      line(c,-.1,-.26,-.16-gait,-.66,o,.21);line(c,.11,-.26,.16+gait,-.66,o,.21);
      line(c,-.1,-.27,-.16-gait,-.65,'#4d675a',.13);line(c,.11,-.27,.16+gait,-.65,'#4d675a',.13);
      line(c,-.16-gait,-.67,-.34-gait,-.67,o,.15);line(c,.16+gait,-.67,.34+gait,-.67,o,.15);
      poly(c,[[-.24,.57],[.24,.57],[.27,-.32],[.07,-.29],[-.08,-.4],[-.27,-.29]],coat,o,.06);
      line(c,-.22,.26,-.47,.04-gait,o,.21);line(c,-.22,.26,-.47,.04-gait,skin,.13);line(c,-.47,.04-gait,-.64,.16-gait,skin,.1);
      line(c,.23,.26,.46,.25+gait,o,.21);line(c,.23,.26,.46,.25+gait,skin,.13);line(c,.46,.25+gait,.65,.21+gait,skin,.1);
      circle(c,.01,.84,.27,skin,o,.055);poly(c,[[-.23,.94],[-.13,1.13],[.12,1.13],[.26,.98],[.02,1.03]],'#385a4f',o,.025);
      circle(c,-.075,.87,.05,o);circle(c,.11,.87,.05,o);circle(c,-.075,.88,.015,'#f8dfa2');circle(c,.11,.88,.015,'#f8dfa2');
      line(c,-.05,.71,.12,.7,o,.045);line(c,.03,.3,.03,-.19,'#334f49',.025);
      if(variant===1)poly(c,[[-.27,1.03],[-.19,1.23],[.2,1.23],[.28,1.02]],'#a97843',o,.04);
      if(variant===2){line(c,-.2,.32,.15,.05,'#b6bf83',.035);poly(c,[[-.16,.49],[.14,.49],[.01,.21]],'#b9b892');}
    }
    _paintMonster(c){
      const o=this._biome.outline;
      poly(c,[[-1.45,0],[-1.48,.37],[-1,.65],[-.52,.55],[-.47,.03]],'#3b574a',o,.09);
      poly(c,[[.47,.03],[.52,.55],[1,.65],[1.48,.37],[1.45,0]],'#3b574a',o,.09);
      poly(c,[[-1.02,.45],[-.92,1.72],[-.45,1.74],[-.31,.44]],'#657657',o,.07);poly(c,[[.31,.44],[.45,1.74],[.92,1.72],[1.02,.45]],'#657657',o,.07);
      poly(c,[[-.98,1.4],[-1.25,2.45],[-1.21,3.47],[-.83,3.95],[.83,3.95],[1.21,3.47],[1.25,2.45],[.98,1.4],[0,1.25]],'#728365',o,.09);
      poly(c,[[-1.14,3.48],[-1.66,3.02],[-1.8,2.03],[-1.28,1.75],[-.98,2.8]],'#4a6852',o,.07);poly(c,[[1.14,3.48],[1.66,3.02],[1.8,2.03],[1.28,1.75],[.98,2.8]],'#4a6852',o,.07);
      for(let s=-1;s<=1;s+=2)for(let i=0;i<3;i++)poly(c,[[s*(1.44+i*.11),2.03],[s*(1.36+i*.11),1.65],[s*(1.53+i*.1),1.8]],'#d9cf9a',o,.035);
      poly(c,[[-.74,3.54],[-.85,4.07],[-.56,4.48],[.56,4.48],[.85,4.07],[.74,3.54],[0,3.36]],'#8b9e73',o,.075);
      poly(c,[[-.66,4.29],[-.95,4.89],[-.35,4.47]],'#e0cfa0',o,.045);poly(c,[[.35,4.47],[.95,4.89],[.66,4.29]],'#e0cfa0',o,.045);
      poly(c,[[-.64,4.13],[-.12,4.01],[-.2,3.82],[-.55,3.89]],o);poly(c,[[.12,4.01],[.64,4.13],[.55,3.89],[.2,3.82]],o);
      line(c,-.49,3.99,-.24,3.94,'#ffd281',.075);line(c,.24,3.94,.49,3.99,'#ffd281',.075);line(c,-.31,3.62,.31,3.62,o,.09);
      poly(c,[[-.97,3.44],[-.3,3.2],[0,3.4],[.3,3.2],[.97,3.44],[.64,2.96],[-.64,2.96]],'#4d6753',o,.04);
      line(c,-.75,2.32,.75,2.32,'#a1ac7f',.06);line(c,-.56,1.84,.56,1.84,'#3a5748',.06);
      circle(c,0,2.85,.43,'#253f37',o,.07);circle(c,0,2.85,.29,'#d1a85e');circle(c,0,2.85,.14,'#ffedb0');
    }
    _paintProp(c,kind){
      const b=this._biome,o=b.outline,g=b.ground.grass,stone=b.ground.top;
      if(kind==='cactus'){
        line(c,0,0,0,2.5,o,.29);line(c,0,0,0,2.5,g,.19);line(c,0,1.13,-.65,1.13,o,.25);line(c,-.65,1.13,-.65,1.95,o,.25);line(c,0,1.13,-.65,1.13,g,.15);line(c,-.65,1.13,-.65,1.95,g,.15);line(c,0,1.7,.52,1.7,o,.25);line(c,.52,1.7,.52,2.23,o,.25);line(c,0,1.7,.52,1.7,g,.15);line(c,.52,1.7,.52,2.23,g,.15);line(c,-.035,.3,-.035,2.34,'#adbc83',.025);
      }else if(kind==='deadTree'){
        poly(c,[[-.15,0],[-.07,2.9],[.12,3.6],[.16,1.4],[.3,0]],'#596658',o,.06);line(c,.03,1.1,-.66,1.9,o,.16);line(c,-.66,1.9,-1,2.65,o,.1);line(c,-.66,1.9,-1.2,2.1,o,.08);line(c,.08,2.1,.8,2.7,o,.13);line(c,.8,2.7,1.1,3.2,o,.09);line(c,.8,2.7,1.2,2.85,o,.075);
      }else if(kind==='pine'){
        line(c,0,0,0,3.5,o,.18);for(let i=0;i<4;i++)poly(c,[[-1.15+i*.2,.5+i*.66],[0,2.05+i*.66],[1.15-i*.2,.5+i*.66]],i%2?'#3c5d50':'#4a7060',o,.045);
      }else if(kind==='tombstone'){
        poly(c,[[-.45,0],[-.45,1.13],[-.26,1.46],[.22,1.49],[.48,1.15],[.48,0]],'#829384',o,.06);line(c,-.22,.91,.24,.91,'#526f62',.04);line(c,0,.71,0,1.17,'#526f62',.04);line(c,-.21,.39,.24,.39,'#526f62',.025);
      }else if(kind==='cross'){
        poly(c,[[-.09,0],[-.09,1.12],[-.49,1.12],[-.49,1.33],[-.09,1.33],[-.09,1.82],[.1,1.82],[.1,1.33],[.49,1.33],[.49,1.12],[.1,1.12],[.1,0]],'#7b8b73',o,.055);
      }else if(kind==='bones'){
        circle(c,-.33,.22,.29,'#d1c5a0',o,.04);circle(c,-.43,.24,.06,o);circle(c,-.25,.24,.06,o);line(c,-.1,.07,.95,.32,'#d1c5a0',.1);for(let i=0;i<4;i++)line(c,.12+i*.19,.13+i*.025,.08+i*.2,.48+i*.025,'#d1c5a0',.065);
      }else if(kind==='wreck'){
        poly(c,[[-1.5,.05],[-1.45,.7],[-.72,.8],[-.42,1.36],[.4,1.22],[.9,.63],[1.4,.56],[1.53,.08]],'#775c49',o,.08);poly(c,[[-.52,.82],[-.31,1.19],[.29,1.1],[.65,.72]],'#34534d',o,.035);circle(c,-.88,.17,.32,'#263c35',o,.05);circle(c,.96,.12,.29,'#263c35',o,.05);line(c,-1.3,.56,1.14,.38,'#b18454',.055);
      }else if(kind==='drum'){
        poly(c,[[-.36,0],[-.36,.99],[.36,.99],[.36,0]],'#8e6c46',o,.06);line(c,-.35,.23,.35,.23,o,.06);line(c,-.35,.78,.35,.78,o,.06);circle(c,0,.48,.13,'#d4b97c',o,.035);
      }else if(kind==='fence'){
        for(let i=0;i<4;i++)poly(c,[[-1.5+i*.85,0],[-1.5+i*.85,1.35],[-1.4+i*.85,1.5],[-1.3+i*.85,1.35],[-1.3+i*.85,0]],'#73826c',o,.045);line(c,-1.55,.42,1.4,.7,'#475f50',.1);line(c,-1.55,1.03,1.4,1.22,'#475f50',.1);
      }else if(kind==='ruin'){
        poly(c,[[-1.45,0],[-1.45,2.34],[-1.1,2.34],[-1.1,1.95],[-.65,1.95],[-.65,3.45],[-.2,3.45],[-.2,3.05],[.38,3.05],[.38,2.45],[.85,2.45],[.85,1.65],[1.4,1.65],[1.4,0]],stone,o,.07);c.fillStyle=o;c.fillRect(-.35,.85,.48,.8);c.fillRect(-1.11,1.27,.32,.53);line(c,-1.2,.45,1.21,.45,b.ground.body,.065);
      }else if(kind==='lamp'){
        line(c,0,0,0,3.7,o,.13);line(c,0,3.7,.7,3.7,o,.13);poly(c,[[.42,3.62],[.88,3.62],[1.05,3.35],[.26,3.35]],'#9c8c60',o,.05);const grad=c.createRadialGradient(.66,3.34,.03,.66,3.34,.85);grad.addColorStop(0,'#f9dd9977');grad.addColorStop(1,'#f9dd9900');c.fillStyle=grad;c.fillRect(-.2,2.49,1.72,1.72);circle(c,.66,3.35,.1,'#f5dfa3');
      }else if(kind==='chimney'){
        poly(c,[[-.6,0],[-.5,3.25],[-.65,3.25],[-.65,3.53],[.57,3.53],[.57,3.25],[.43,3.25],[.56,0]],'#6b5b4d',o,.07);for(let i=0;i<5;i++)line(c,-.47,.45+i*.53,.45,.45+i*.53,'#99795a',.06);poly(c,[[-1.3,0],[-1.3,.95],[.9,1.22],[1.4,.53],[1.4,0]],'#4f5346',o,.055);
      }else{
        poly(c,[[-.84,0],[-.64,.47],[-.15,.72],[.51,.52],[.89,0]],stone,o,.055);poly(c,[[-.58,.38],[-.13,.64],[.43,.47],[.08,.35]],b.ground.rim);
      }
    }
    _paintSign(c,label){
      const o=this._biome.outline;line(c,0,0,0,1.92,'#6b7960',.08);
      if(label==='JUMP'){poly(c,[[0,2.3],[-.65,1.42],[.65,1.42]],'#dfbb68',o,.055);line(c,-.3,1.61,.3,1.96,o,.065);}
      else{poly(c,[[-.7,1.45],[.7,1.45],[.7,2.03],[-.7,2.03]],'#355347',o,.045);this._bakedText(c,label,0,1.64,.25,'#e0e6bd');}
    }
    _buildBackground(){
      const b=this._biome,s=Math.min(this.renderScale,1.5);this._ridges=[];
      this._ridgeWidth=Math.max(1024,Math.ceil(this.width));this._ridgeHeight=Math.ceil(this.height*.62);
      for(let layer=0;layer<3;layer++){
        const r=b.ridges[layer],canvas=makeCanvas(this._ridgeWidth*s,this._ridgeHeight*s),c=canvas.getContext('2d'),w=this._ridgeWidth,h=this._ridgeHeight;
        c.scale(s,s);c.fillStyle=r.color;c.beginPath();c.moveTo(0,h);
        const steps=32;for(let i=0;i<=steps;i++){
          const x=i/steps*w,n=i===steps?0:i,noise=hash(n*5+layer*53+this._stageIndex*17),y=h*(.55-noise*.43);
          if(r.style==='dunes'){const a=Math.sin(i/steps*TAU*3)*h*.14;c.lineTo(x,h*.44+a);}
          else if(r.style==='mesa'){c.lineTo(x-w/steps*.22,y+h*.09);c.lineTo(x+w/steps*.16,y+h*.09);c.lineTo(x+w/steps*.27,y+h*.28);}
          else if(r.style==='industrial'||r.style==='ruins'){
            c.lineTo(x,y+h*.12);c.lineTo(x,y-h*.05);c.lineTo(x+w/steps*.43,y-h*.05);c.lineTo(x+w/steps*.43,y+h*.12);if(r.style==='industrial'){c.lineTo(x+w/steps*.58,y+h*.12);c.lineTo(x+w/steps*.58,y-h*.13);c.lineTo(x+w/steps*.75,y-h*.13);c.lineTo(x+w/steps*.75,y+h*.12);}
          }else if(r.style==='spires'){c.lineTo(x-w/steps*.36,y+h*.22);c.lineTo(x,y-h*.06);c.lineTo(x+w/steps*.18,y+h*.04);c.lineTo(x+w/steps*.36,y+h*.25);}
          else{c.lineTo(x,y);c.lineTo(x+w/steps*.35,y+h*.12);}
        }
        c.lineTo(w,h);c.closePath();c.fill();
        // Sparse broad facets are baked into the silhouettes, never stroked live.
        for(let i=0;i<16;i++){const x=i/16*w,y=h*(.39-hash(i+layer*19)*.2);poly(c,[[x,y],[x+w*.025,y+h*.08],[x+w*.052,h],[x+w*.015,h]],r.shade);}
        this._screenBytes+=canvas.width*canvas.height*4;this._ridges.push(canvas);
      }
      this._sun=makeCanvas(256,256);const sc=this._sun.getContext('2d'),sg=sc.createRadialGradient(128,128,4,128,128,126);
      sg.addColorStop(0,b.sun.glow+'a0');sg.addColorStop(.28,b.sun.glow+'44');sg.addColorStop(1,b.sun.glow+'00');sc.fillStyle=sg;sc.fillRect(0,0,256,256);circle(sc,128,128,b.sun.radius*.9,b.sun.color);
      if(b.sun.kind==='moon'){circle(sc,118,120,5,'#a6c5b32e');circle(sc,137,136,7,'#8ba99c28');circle(sc,140,115,3,'#8ba99c33');}
      this._screenBytes+=256*256*4;
      this._clouds=makeCanvas(1024,128);const cc=this._clouds.getContext('2d');cc.fillStyle=b.clouds.color;cc.globalAlpha=b.clouds.alpha;
      for(let i=0;i<b.clouds.count;i++){const x=i/b.clouds.count*1024+40,y=20+hash(i+8)*75;cc.beginPath();cc.ellipse(x,y,65+hash(i)*45,4+hash(i+9)*7,0,0,TAU);cc.fill();cc.beginPath();cc.ellipse(x+34,y-4,36,8,0,0,TAU);cc.fill();}
      this._screenBytes+=1024*128*4;
      this._stars=new Path2D();for(let i=0;i<100*b.stars;i++){const x=hash(i+871)*this.width,y=hash(i+432)*this.height*.6,r=.5+hash(i+32)*1.1;this._stars.rect(x,y,r,r);}
      this._chasm=makeCanvas(32,256);const gc=this._chasm.getContext('2d'),gg=gc.createLinearGradient(0,0,0,256);gg.addColorStop(0,b.ground.chasm[1]);gg.addColorStop(1,b.ground.chasm[0]);gc.fillStyle=gg;gc.fillRect(0,0,32,256);this._screenBytes+=32*256*4;
      this._particleSprites=[];const colors=[b.dust,'#92a19a','#f8da8c','#f3df9d','#ac9271',b.accent,'#dce8c3',b.dust];
      for(let i=0;i<8;i++){
        const canvas=makeCanvas(48,48),c=canvas.getContext('2d');
        if(i===0||i===1||i===7){const g=c.createRadialGradient(24,24,1,24,24,23);g.addColorStop(0,colors[i]+'bb');g.addColorStop(.45,colors[i]+'77');g.addColorStop(1,colors[i]+'00');c.fillStyle=g;c.fillRect(0,0,48,48);}
        else if(i===3){poly(c,[[24,2],[29,18],[46,19],[33,29],[38,45],[24,35],[10,45],[15,29],[2,19],[19,18]],colors[i]);}
        else if(i===4){poly(c,[[7,8],[38,5],[42,35],[13,43]],colors[i],b.outline,2);}
        else if(i===5){c.fillStyle=colors[i];c.fillRect(13,9,22,29);}
        else {const g=c.createRadialGradient(24,24,1,24,24,20);g.addColorStop(0,'#fff4cb');g.addColorStop(.3,colors[i]+'cc');g.addColorStop(1,colors[i]+'00');c.fillStyle=g;c.fillRect(0,0,48,48);}
        this._particleSprites.push(canvas);this._screenBytes+=48*48*4;
      }
    }
    _buildScreenGradients(){
      const c=this.ctx,b=this._biome;c.setTransform(this.renderScale,0,0,this.renderScale,0,0);
      this._skyGradient=c.createLinearGradient(0,0,0,this.height);this._skyGradient.addColorStop(0,b.sky[0]);this._skyGradient.addColorStop(.57,b.sky[1]);this._skyGradient.addColorStop(1,b.sky[2]);
      this._vignette=c.createRadialGradient(this.width*.48,this.height*.46,this.height*.12,this.width*.5,this.height*.5,Math.max(this.width*.68,this.height*.75));this._vignette.addColorStop(0,'#0c202500');this._vignette.addColorStop(1,'#0c2025'+Math.round(b.light.vignette*255).toString(16).padStart(2,'0'));
      this._haze=c.createLinearGradient(0,this.height*.45,0,this.height*.88);this._haze.addColorStop(0,b.haze+'00');this._haze.addColorStop(.7,b.haze+'35');this._haze.addColorStop(1,b.haze+'00');
    }
    _sprite(sprite,x,y,angle=0,scale=1){
      if(!sprite)return;const c=this.ctx;c.save();c.translate(x,y);if(angle)c.rotate(angle);if(scale!==1)c.scale(scale,scale);
      c.drawImage(sprite.canvas,sprite.left,sprite.bottom,sprite.w,sprite.h);c.restore();this._stats.drawOps++;
    }
    _fill(path,color){this.ctx.fillStyle=color;this.ctx.fill(path);this._stats.drawOps++;}
    _poseAt(slot,fallback,out){
      const p=this._pose,i=slot*3;
      if(p&&Number.isFinite(p[i])){out[0]=p[i];out[1]=finite(p[i+1]);out[2]=finite(p[i+2]);}
      else{out[0]=finite(fallback&&fallback.x);out[1]=finite(fallback&&fallback.y);out[2]=finite(fallback&&fallback.angle);}
      return out;
    }
    _preparePose(state,pose){
      if(pose&&pose.length>=9){this._pose=pose;return;}
      const p=this._fallbackPose;p.fill(NaN);this._pose=p;
      p[0]=finite(state.x);p[1]=finite(state.y,1.43);p[2]=finite(state.angle);
      const wheels=state.wheels;
      for(let i=0;i<2;i++){const w=wheels&&wheels[i],n=(i+1)*3;p[n]=w?finite(w.x):p[0]+(i?1.57:-1.57);p[n+1]=w?finite(w.y):p[1]-.65;p[n+2]=w?finite(w.angle):0;}
      const rival=state.rival;
      if(rival){p[9]=finite(rival.x);p[10]=finite(rival.y);p[11]=finite(rival.angle);for(let i=0;i<2;i++){const w=rival.wheels&&rival.wheels[i],n=12+i*3;p[n]=w?finite(w.x):p[9]+(i?1.57:-1.57);p[n+1]=w?finite(w.y):p[10]-.65;p[n+2]=w?finite(w.angle):0;}}
      if(state.projectile){p[18]=finite(state.projectile.x);p[19]=finite(state.projectile.y);p[20]=finite(state.projectile.angle);}
      const zombies=this._physics&&this._physics.zombies;
      if(zombies)for(let i=0;i<zombies.length;i++){const z=zombies[i],n=(ZOMBIES+i)*3;if(n+2>=p.length)break;p[n]=finite(z.x);p[n+1]=finite(z.y);p[n+2]=finite(z.angle);}
    }
    _updateCamera(frame,dt){
      const p=this._pose,state=this._state,layout=frame.layout||EMPTY;let px=finite(p&&p[0],finite(state.x)),py=finite(p&&p[1],finite(state.y,1.43));
      const speed=Math.abs(finite(state.speed)),flight=finite(state.airtime),zoom=1-Math.min(.12,speed/210)-((flight>.4&&!state.grounded)?Math.min(.08,(flight-.4)*.07):0);
      const settings=frame.settings||EMPTY,encounter=frame.encounter||EMPTY,m=state.monster;
      const requested=frame.mode==='playing'&&m&&encounter.phase!=='idle'?clamp(finite(encounter.intensity),0,1):0;
      this._focus+=(requested-this._focus)*(1-Math.exp(-dt*9));
      if(this._snap)this._focus=requested;
      // Fit both ends of the shot instead of letting the target live outside the
      // phone viewport. The minimum-size reticle below stays legible when wide.
      const focus=settings.reducedMotion?0:this._focus;
      let targetScale=this._baseScale*zoom*(1+(settings.reducedMotion?0:this._zoomPunch*.035));
      if(focus>.001&&m){
        const span=Math.max(8,Math.abs(m.x-px)+7),fit=(this.width-Math.max(34,this.width*.13)*2)/span;
        targetScale+=(Math.min(targetScale,layout.touch&&encounter.phase!=='aim'?Math.max(fit,this._baseScale*.78):fit)-targetScale)*focus;
      }
      if(this._snap)this._cameraScale=targetScale;else this._cameraScale+=(targetScale-this._cameraScale)*(1-Math.exp(-dt*(focus>.01?9:3.7)));
      const s=this._cameraScale,view=this.width/s,look=clamp(finite(state.vx,finite(state.speed))*.35,-3,7);
      let tx=px+clamp(view*.14+look,-view*.15,view*.3);
      const safeTop=clamp(finite(layout.safeTop),0,this.height*.45),safeBottom=clamp(finite(layout.safeBottom),0,this.height*.55);
      const desired=clamp(this.height*(layout.touch?.64:.67),safeTop+s*1.7,Math.max(safeTop+s*1.7,this.height-safeBottom-s*1.4));
      let ty=py+(desired-this.height*.73)/s;
      if(focus>.001&&m){
        const shotCenter=layout.touch&&encounter.phase!=='aim'?(state.projectile?(state.projectile.x+m.x)*.5:m.x-2):(px+m.x)*.5;tx+=(shotCenter-tx)*focus;
        const centerY=(Math.min(py-1.1,m.y)+Math.max(py+2,m.y+5.4))*.5;
        const safeCenter=(safeTop+this.height-safeBottom)*.5;
        ty+=(centerY+(safeCenter-this.height*.73)/s-ty)*focus;
      }
      if(frame.mode==='title'){
        const track=this._track,travel=track?Math.max(1,track.length-35):100;
        tx=(track?track.startX:0)+12+(this._clock*2.1)%travel;ty=this._heightAt(tx)-.25;
      }
      if(this._snap){this._cameraX=tx;this._cameraY=ty;this._snap=false;}
      else if(dt>0){
        const omega=focus>.01?9:5.3,e=Math.exp(-omega*dt),dx=this._cameraX-tx,jx=this._cameraVX+omega*dx,dy=this._cameraY-ty,jy=this._cameraVY+omega*dy;
        this._cameraX=tx+(dx+jx*dt)*e;this._cameraVX=(this._cameraVX-omega*jx*dt)*e;
        this._cameraY=ty+(dy+jy*dt)*e;this._cameraVY=(this._cameraVY-omega*jy*dt)*e;
      }
      this._trauma=Math.max(0,this._trauma-dt*1.4);this._zoomPunch*=Math.exp(-dt*10);
      const shake=settings.shake!==false&&!settings.reducedMotion?this._trauma*this._trauma*14:0;
      const sx=Math.sin(this._clock*39.7)*Math.cos(this._clock*17.3)*shake,sy=Math.sin(this._clock*31.1+.7)*Math.cos(this._clock*13.7)*shake;
      // Translation is snapped AFTER interpolating the physical pose/camera.
      this._ox=Math.round((this.width*.5-this._cameraX*s+sx)*this.renderScale)/this.renderScale;
      this._oy=Math.round((this.height*.73+this._cameraY*s+sy)*this.renderScale)/this.renderScale;
      this._left=-this._ox/s-3;this._right=(this.width-this._ox)/s+3;this._top=this._oy/s+3;this._bottom=(this._oy-this.height)/s-3;
      this._worldDetail=Math.min(this._detail,s<this._baseScale*.72?0:this._detail);
      const actual=s*this.renderScale;let best=Infinity;
      for(let i=0;i<this._banks.length;i++){const error=Math.abs(Math.log(actual/this._banks[i].ppu));if(error<best){best=error;this._bank=this._banks[i];}}
    }
    _drawBackground(){
      const c=this.ctx,b=this._biome,w=this.width,h=this.height;c.setTransform(this.renderScale,0,0,this.renderScale,0,0);
      c.fillStyle=this._skyGradient;c.fillRect(0,0,w,h);this._stats.drawOps++;
      if(b.stars){c.fillStyle='#eef2d7';c.globalAlpha=.45+b.stars*.35;c.fill(this._stars);c.globalAlpha=1;this._stats.drawOps++;}
      const sunSize=clamp(h*.31,140,285),sunX=w*b.sun.x-this._cameraX*.35,sunY=h*b.sun.y+this._cameraY*1.2;
      c.drawImage(this._sun,sunX-sunSize/2,sunY-sunSize/2,sunSize,sunSize);this._stats.drawOps++;
      const cloudW=Math.max(1024,w),cloudOffset=((this._cameraX*1.1+this._clock*1.8)%cloudW+cloudW)%cloudW;
      c.drawImage(this._clouds,-cloudOffset,h*.12,cloudW,128);c.drawImage(this._clouds,cloudW-cloudOffset,h*.12,cloudW,128);this._stats.drawOps+=2;
      const start=this._detail===0?1:0;
      for(let i=start;i<3;i++){
        const r=b.ridges[i],rw=this._ridgeWidth,offset=((this._cameraX*this._cameraScale*r.parallax)%rw+rw)%rw;
        const y=h*(.61-r.height*.45)+this._cameraY*this._cameraScale*r.parallax;
        c.drawImage(this._ridges[i],-offset,y,rw,this._ridgeHeight);c.drawImage(this._ridges[i],rw-offset,y,rw,this._ridgeHeight);this._stats.drawOps+=2;
      }
      c.fillStyle=this._haze;c.fillRect(0,h*.4,w,h*.6);this._stats.drawOps++;
    }
    _worldTransform(){const k=this._cameraScale*this.renderScale;this.ctx.setTransform(k,0,0,-k,this._ox*this.renderScale,this._oy*this.renderScale);}
    _drawWorld(){
      const c=this.ctx,b=this._biome,bank=this._bank,left=this._left,right=this._right;
      for(let i=0;i<this._gaps.length;i++){const g=this._gaps[i];if(g.right<left||g.left>right)continue;c.drawImage(this._chasm,g.left,-80,g.right-g.left,g.top+80);this._stats.drawOps++;this._fill(g.leftFace,b.ground.chasm[0]);this._fill(g.rightFace,b.ground.body);}
      for(let i=0;i<this._props.length;i++){
        const p=this._props[i];if(p.x<left-2||p.x>right+2||p.detail>this._worldDetail)continue;
        c.save();c.translate(p.x,p.y);c.scale(p.scale*p.flip,p.scale);const s=bank.props[p.kind]||bank.props.rock;c.drawImage(s.canvas,s.left,s.bottom,s.w,s.h);c.restore();this._stats.drawOps++;
      }
      for(let i=0;i<this._chunks.length;i++){
        const ch=this._chunks[i];if(ch.right<left||ch.left>right)continue;
        this._fill(ch.body,b.ground.body);
        const bands=this._worldDetail===0?2:4;for(let j=0;j<bands;j++)this._fill(ch.bands[j],b.ground.strata[j]);
        if(this._worldDetail>0){this._fill(ch.specks[0],b.ground.speckle[0]);this._fill(ch.specks[1],b.ground.speckle[1]);}
        this._fill(ch.top,b.ground.top);this._fill(ch.rim,b.ground.rim);if(this._worldDetail>0)this._fill(ch.grass,b.ground.grass);
      }
      for(let i=0;i<this._signs.length;i++){const p=this._signs[i];if(p.x>=left-1&&p.x<=right+1)this._sprite(bank.signs[p.label],p.x,p.y);}
      const cp=finite(this._state.checkpointIndex,finite(this._physics.checkpointIndex));
      for(let i=0;i<this._flags.length;i++){const p=this._flags[i];if(p.x>=left-1&&p.x<=right+1)this._sprite(bank.flags[i*2+(cp>=i?1:0)],p.x,p.y);}
      if(this._track.finishX>=left-3&&this._track.finishX<=right+3)this._sprite(bank.finish,this._track.finishX,this._heightAt(this._track.finishX));
    }
    _drawTruck(pose,offset,rival=false,ghost=false){
      const x=pose[offset],y=pose[offset+1],angle=finite(pose[offset+2]);if(!Number.isFinite(x)||x<this._left-4||x>this._right+4)return;
      const c=this.ctx,bank=this._bank,state=rival?(this._state.rival||EMPTY):this._state,cos=Math.cos(angle),sin=Math.sin(angle),ground=this._heightAt(x);
      if(!ghost&&y-ground<7){c.globalAlpha=clamp(.6-(y-ground)*.06,.1,.55);this._sprite(bank.shadow,x,ground+.015);c.globalAlpha=1;}
      if(!ghost){
        // Both spring endpoints use interpolated rigid bodies. The coil remains
        // a short batched path rather than a stretched suspension sprite.
        c.beginPath();for(let i=0;i<2;i++){const local=i?1.26:-1.26,mx=x+cos*local-sin*.12,my=y+sin*local+cos*.12,n=offset+3+i*3;c.moveTo(mx,my);c.lineTo(pose[n],pose[n+1]);}
        c.strokeStyle='#162d31';c.lineWidth=.115;c.stroke();this._stats.drawOps++;
        c.beginPath();for(let i=0;i<2;i++){const local=i?1.26:-1.26,mx=x+cos*local-sin*.12,my=y+sin*local+cos*.12,n=offset+3+i*3;c.moveTo(mx,my);c.lineTo(pose[n],pose[n+1]);}
        c.strokeStyle='#93aaa1';c.lineWidth=.04;c.stroke();this._stats.drawOps++;
        c.beginPath();for(let i=0;i<2;i++){const local=i?1.26:-1.26,mx=x+cos*local-sin*.12,my=y+sin*local+cos*.12,n=offset+3+i*3,dx=pose[n]-mx,dy=pose[n+1]-my,len=Math.hypot(dx,dy)||1,nx=-dy/len*.055,ny=dx/len*.055;c.moveTo(mx,my);for(let j=1;j<8;j++){const side=j%2?1:-1;c.lineTo(mx+dx*j/8+nx*side,my+dy*j/8+ny*side);}c.lineTo(pose[n],pose[n+1]);}
        c.strokeStyle=rival?'#d3ac79':'#e9d58b';c.lineWidth=.028;c.stroke();this._stats.drawOps++;
      }
      this._sprite(rival?bank.rival:bank.player,x,y,angle);
      const blur=Math.abs(finite(state.wheelSpeed))>18?1:0;
      for(let i=0;i<2;i++){const n=offset+3+i*3;if(Number.isFinite(pose[n]))this._sprite(bank.wheels[(rival?2:0)+blur],pose[n],pose[n+1],finite(pose[n+2]));}
      if(!ghost&&!rival){
        if(this._input.brake){this._sprite(bank.brake,x+cos*-2.15-sin*.18,y+sin*-2.15+cos*.18);}
        if(this._biome.light.headlights){c.globalCompositeOperation='screen';this._sprite(bank.headlight,x+cos*2.05-sin*.16,y+sin*2.05+cos*.16,angle);c.globalCompositeOperation='source-over';}
      }
    }
    _drawEntities(){
      const c=this.ctx,bank=this._bank,physics=this._physics,state=this._state,pose=this._pose;
      const cans=physics.fuelCans||EMPTY;
      for(let i=0;i<cans.length;i++){const can=cans[i];if(can.collected||can.x<this._left-1||can.x>this._right+1)continue;this._sprite(bank.fuel,can.x,can.y+Math.sin(this._clock*2.6+i)*.08);}
      const zombies=physics.zombies||EMPTY;
      for(let i=0;i<zombies.length;i++){
        const z=zombies[i],n=(ZOMBIES+i)*3,x=Number.isFinite(pose[n])?pose[n]:z.x,y=Number.isFinite(pose[n+1])?pose[n+1]:z.y;
        if(x<this._left-1||x>this._right+1||(z.hit&&z.timeSinceHit>2.2))continue;
        c.globalAlpha=z.hit?clamp(1-finite(z.timeSinceHit)/2.2,0,1):1;
        const walk=z.hit?0:((Math.floor(this._worldClock*5+i)&1));this._sprite(bank.zombies[(i%3)*2+walk],x,y,Number.isFinite(pose[n+2])?pose[n+2]:finite(z.angle));
      }
      c.globalAlpha=1;const m=state.monster;
      if(m&&m.x>=this._left-3&&m.x<=this._right+3&&(m.alive||finite(m.timeSinceHit)<1.2)){
        const t=finite(m.timeSinceHit);c.globalAlpha=m.alive?1:clamp(1-t/1.2,0,1);this._sprite(bank.monster,m.x,m.y,m.alive?0:-Math.min(1.3,t*1.7));c.globalAlpha=1;
        if(m.alive){const tx=m.weakpoint?m.weakpoint.x:m.x,ty=m.weakpoint?m.weakpoint.y:m.y+2.85,locked=state.weapon&&state.weapon.canHit;c.globalAlpha=locked?1:.55;this._sprite(bank.target,tx,ty,Math.sin(this._clock)*.07);if(locked){const radius=Math.max(.65,18/this._cameraScale)*(1+Math.sin(this._clock*6)*.08);c.strokeStyle='#e4f5ab';c.lineWidth=2/this._cameraScale;c.beginPath();for(let i=0;i<4;i++)c.arc(tx,ty,radius,i*Math.PI/2+.14,i*Math.PI/2+1.1);c.stroke();this._stats.drawOps++;}c.globalAlpha=1;}
      }
    }
    _drawCannon(){
      const state=this._state,weapon=state.weapon;if(!weapon||!this._pose)return;
      const p=this._pose,x=p[0],y=p[1],a=finite(p[2]),cos=Math.cos(a),sin=Math.sin(a),mx=x+cos*.2-sin*1.4,my=y+sin*.2+cos*1.4;
      // Interpolate the mount with the chassis; aim is a world angle supplied by
      // physics. Preserve the shot angle during its flash, even after a kill.
      const angle=this._muzzle>0?this._shotAngle:finite(weapon.angle,a);
      this._sprite(this._bank.cannon,mx-Math.cos(angle)*this._kick*.13,my-Math.sin(angle)*this._kick*.13,angle);
      if(this._muzzle>0){this.ctx.globalAlpha=clamp(this._muzzle/.12,0,1);this._sprite(this._bank.flash,mx+Math.cos(angle)*1.45,my+Math.sin(angle)*1.45,angle);this.ctx.globalAlpha=1;}
      const n=PROJECTILE*3;
      if(state.projectile){const px=Number.isFinite(this._pose[n])?this._pose[n]:state.projectile.x,py=Number.isFinite(this._pose[n+1])?this._pose[n+1]:state.projectile.y;const a=finite(state.projectile.angle);this.ctx.strokeStyle='#f9e9ac';this.ctx.lineWidth=2/this._cameraScale;this.ctx.beginPath();this.ctx.moveTo(px-Math.cos(a)*2,py-Math.sin(a)*2);this.ctx.lineTo(px,py);this.ctx.stroke();this._stats.drawOps++;this._sprite(this._bank.projectile,px,py,a);}
    }
    _spawn(x,y,count,kind,power=1){
      const total=Math.min(MAX_PARTICLES,Math.ceil(count*this.particleScale));
      for(let i=0;i<total;i++){
        const n=this._particleHead*PS;this._particleHead=(this._particleHead+1)%MAX_PARTICLES;
        const angle=Math.random()*TAU,speed=(.35+Math.random()*2.5)*power,d=this._particles;
        d[n]=finite(x);d[n+1]=finite(y);d[n+2]=Math.cos(angle)*speed;d[n+3]=Math.sin(angle)*speed+power*.5;
        d[n+4]=d[n+5]=kind===1?.65+Math.random()*.45:kind===5?1.3+Math.random():.38+Math.random()*.55;
        d[n+6]=kind===0||kind===1||kind===7?.13+Math.random()*.18:kind===2?.055+Math.random()*.07:.08+Math.random()*.1;
        d[n+7]=kind;d[n+8]=Math.random()*TAU;d[n+9]=(Math.random()-.5)*9;
      }
    }
    popup(text,x,y,style='score'){
      if(text==null)return;const i=this._popupHead;this._popupHead=(i+1)%POPUPS;
      const n=i*5,p=this._popupData;p[n]=finite(x);p[n+1]=finite(y);p[n+2]=0;p[n+3]=style==='big'?1.6:1.15;
      p[n+4]=style==='trick'?1:style==='fuel'?2:style==='warn'?3:style==='big'?4:0;this._popupText[i]=String(text);
    }
    onEvent(event,state=EMPTY){
      if(!event||typeof event.type!=='string')return;
      const x=finite(event.x,finite(state.x)),y=finite(event.y,finite(state.y)),s=clamp(finite(event.strength,.5),0,1);
      switch(event.type){
        case 'shot':this._kick=1.5;this._muzzle=.12;this._shotAngle=finite(event.angle,state.weapon?finite(state.weapon.angle):0);this._spawn(x,y,9,1,.85);this._spawn(x,y,6,2,1.6);this.addTrauma(.16);break;
        case 'land':this._spawn(x,y-1,18+Math.floor(s*14),0,.7+s);this._spawn(x,y-1,Math.floor(s*7),4,s);this.addTrauma(s*.2);break;
        case 'landing':if(event.perfect){this._spawn(x,y-.7,9,2,.8);this._zoomPunch=.55;}if(event.bigAir)this.addTrauma(.14);break;
        case 'takeoff':this._spawn(x,y-.7,6,0,.6);break;
        case 'fuel':this._spawn(x,y,11,2,1.1);this.popup('+'+Math.round(finite(event.amount,32))+' FUEL',x,y+1,'fuel');break;
        case 'zombie':this._spawn(x,y,7,7,.8);this._spawn(x,y+.5,4,3,.65);break;
        case 'collision':this._spawn(x,y,18+Math.floor(s*20),2,1.1+s*1.3);this._spawn(x,y,9,4,s+1.2);this.addTrauma(s*.42);break;
        case 'monsterHit':this._impactTime=.6;this._impactX=x;this._impactY=y;this._spawn(x,y,35,7,2.3);this._spawn(x,y,18,2,2);this._spawn(x,y,10,4,2);this.addTrauma(.35);this._zoomPunch=1;this.flash('#f7df9b',.09);break;
        case 'monsterCrash':this._spawn(x,y,28,4,2.2);this._spawn(x,y,25,0,2.5);this._spawn(x,y,14,2,2);this.addTrauma(.85);this.flash('#df8264',.12);break;
        case 'flip':this._spawn(x,y,4,3,.8);break;
        case 'checkpoint':this._spawn(x,y+2.5,10,2,1.3);break;
        default:break;
      }
    }
    celebrate(kind='clear'){
      const p=this._pose,x=p&&Number.isFinite(p[0])?p[0]:0,y=p&&Number.isFinite(p[1])?p[1]:2;
      this._spawn(x,y+2,kind==='victory'?95:55,5,3.5);this._spawn(x,y+1,15,2,2);this._zoomPunch=1;this.flash(this._biome?this._biome.accent:'#ecd18b',.14);
    }
    _emitAmbient(dt){
      if(!(dt>0))return;const state=this._state,p=this._pose,playing=this._frame.mode==='playing',speed=Math.abs(finite(state.speed));
      if(playing){
        this._dustClock+=dt;this._exhaustClock+=dt;
        if(this._dustClock>.055&&state.grounded&&speed>1){this._dustClock=0;const contacts=state.wheelContact;for(let i=0;i<2;i++)if(!contacts||contacts[i])this._spawn(p[3+i*3],p[4+i*3]-.62,1+Math.floor(finite(state.slip)*2),0,.35+speed/30);}
        if(this._exhaustClock>.12){this._exhaustClock=0;const a=finite(p[2]);this._spawn(p[0]-Math.cos(a)*1.3-Math.sin(a)*1.2,p[1]-Math.sin(a)*1.3+Math.cos(a)*1.2,1,1,.15+Math.abs(finite(this._input.throttle))*.3);}
      }
      const w=this._biome.weather;if(w.kind==='none'||w.kind==='fog'||this._detail===0)return;
      this._weatherClock+=dt;if(this._weatherClock<.13/Math.max(.15,w.density))return;this._weatherClock=0;
      const count=Math.max(1,Math.round(w.density*this.particleScale*2));
      for(let i=0;i<count;i++){
        const n=this._particleHead*PS;this._particleHead=(this._particleHead+1)%MAX_PARTICLES;const d=this._particles,kind=w.kind==='embers'||w.kind==='fireflies'?6:w.kind==='ash'?7:0;
        d[n]=this._left+Math.random()*(this._right-this._left);d[n+1]=w.kind==='fireflies'?this._heightAt(d[n])+1+Math.random()*4:this._bottom+Math.random()*(this._top-this._bottom);
        d[n+2]=w.kind==='fireflies'?(Math.random()-.5)*.3:-.4-Math.random()*.6;d[n+3]=w.kind==='embers'?.4+Math.random()*.6:w.kind==='fireflies'?.08:-.12-Math.random()*.2;
        d[n+4]=d[n+5]=w.kind==='fireflies'?5:3.5;d[n+6]=kind===6?.045+Math.random()*.04:.1+Math.random()*.08;d[n+7]=kind;d[n+8]=0;d[n+9]=0;
      }
    }
    _drawParticles(dt){
      const c=this.ctx,d=this._particles;let alive=0,drawn=0;const allowance=Math.max(0,Math.min(Math.round((this._detail===2?78:this._detail===1?52:28)*this.particleScale),190-this._stats.drawOps));
      for(let j=0;j<MAX_PARTICLES;j++){
        const i=(this._particleHead-1-j+MAX_PARTICLES)%MAX_PARTICLES,n=i*PS;if(d[n+4]<=0)continue;
        const kind=d[n+7];
        if(dt>0){d[n+4]-=dt;if(d[n+4]<=0)continue;d[n]+=d[n+2]*dt;d[n+1]+=d[n+3]*dt;if(kind===2||kind===3||kind===4||kind===5)d[n+3]-=dt*(kind===5?2:4.8);else d[n+2]*=Math.exp(-dt*.8);d[n+8]+=d[n+9]*dt;if(kind===0||kind===1||kind===7)d[n+6]+=dt*.15;}
        alive++;if(drawn>=allowance||d[n]<this._left-1||d[n]>this._right+1||d[n+1]<this._bottom-1||d[n+1]>this._top+1)continue;
        const r=d[n+6],alpha=clamp(d[n+4]/Math.min(d[n+5],.3),0,1);c.globalAlpha=alpha*(kind===0?.55:kind===1?.32:.9);
        if(kind===3||kind===4||kind===5){c.save();c.translate(d[n],d[n+1]);c.rotate(d[n+8]);c.drawImage(this._particleSprites[kind],-r,-r,r*2,r*2);c.restore();}
        else c.drawImage(this._particleSprites[kind],d[n]-r,d[n+1]-r,r*2,r*2);
        this._stats.drawOps++;drawn++;
      }
      c.globalAlpha=1;this._particleCount=alive;this._stats.particles=alive;
    }
    _drawPopups(dt){
      const c=this.ctx,p=this._popupData;let drawn=0;
      for(let j=0;j<POPUPS;j++){
        const i=(this._popupHead-1-j+POPUPS)%POPUPS,n=i*5;if(p[n+3]<=0)continue;
        if(dt>0)p[n+2]+=dt;if(p[n+2]>=p[n+3]){p[n+3]=0;continue;}
        if(drawn>=8)continue;const x=p[n]*this._cameraScale+this._ox,y=-(p[n+1]+p[n+2]*.9)*this._cameraScale+this._oy;
        if(x<-100||x>this.width+100||y<-40||y>this.height+40)continue;
        const style=p[n+4];c.globalAlpha=clamp((p[n+3]-p[n+2])/.28,0,1);c.font=style===4?'900 18px Arial':'700 13px monospace';c.textAlign='center';c.lineJoin='round';c.lineWidth=3.5;c.strokeStyle=this._biome.outline;c.strokeText(this._popupText[i],x,y);c.fillStyle=style===2?'#f4d487':style===3?'#f0aa83':style===1?'#e8efb1':'#f3edcb';c.fillText(this._popupText[i],x,y);this._stats.drawOps+=2;drawn++;
      }
      c.globalAlpha=1;
    }
    _drawIndicators(){
      if(this._frame.mode!=='playing')return;const c=this.ctx,state=this._state,s=this._cameraScale;c.font='700 11px monospace';c.textBaseline='middle';
      if(state.rival){const px=finite(this._pose[9],state.rival.x)*s+this._ox;if(px<30||px>this.width-30){const right=px>this.width-30,x=right?this.width-18:18,y=this.height*.46;c.beginPath();c.moveTo(x,y);c.lineTo(x+(right?-9:9),y-6);c.lineTo(x+(right?-9:9),y+6);c.closePath();c.fillStyle='#df9c77';c.fill();c.textAlign=right?'right':'left';c.fillText('⚑',x+(right?-16:16),y);this._stats.drawOps+=2;}}
      const m=state.monster;
      if(m&&m.alive){const px=m.x*s+this._ox;if(px>this.width-25){const x=this.width-18,y=this.height*.55;c.beginPath();c.moveTo(x,y);c.lineTo(x-9,y-6);c.lineTo(x-9,y+6);c.closePath();c.fillStyle='#e0b878';c.fill();c.textAlign='right';
        const distance=Math.ceil(state.weapon?finite(state.weapon.distance):Math.max(0,m.x-finite(state.x)));
        if(distance!==this._lastMonsterDistance){this._lastMonsterDistance=distance;this._monsterLabel='◎ '+distance+' m';}c.fillText(this._monsterLabel,x-16,y);this._stats.drawOps+=2;}}
    }
    _drawScreen(dt){
      const c=this.ctx,w=this.width,h=this.height,state=this._state,settings=this._frame.settings||EMPTY,speed=Math.abs(finite(state.speed))*3.6;
      c.setTransform(this.renderScale,0,0,this.renderScale,0,0);
      if(speed>75&&this._frame.mode==='playing'&&!settings.reducedMotion&&this._detail>0){
        const strength=clamp((speed-75)/45,0,.45);c.globalAlpha=strength;c.strokeStyle='#ecebd0';c.lineWidth=1;c.beginPath();
        for(let i=0;i<12;i++){const y=(hash(i+471)*h+this._clock*(17+i*3))%h,left=i%2===0,x=left?hash(i+911)*w*.13:w-hash(i+811)*w*.13;c.moveTo(x,y);c.lineTo(x+(left?30:-30),y);}
        c.stroke();this._stats.drawOps++;c.globalAlpha=1;
      }
      if(this._biome.weather.kind==='fog'&&this._detail>0){c.globalAlpha=.6;c.fillStyle=this._haze;c.fillRect(0,h*.45,w,h*.55);c.globalAlpha=1;this._stats.drawOps++;}
      c.fillStyle=this._vignette;c.fillRect(0,0,w,h);this._stats.drawOps++;
      this._drawPopups(dt);this._drawIndicators();
      if(this._impactTime>0){const t=1-this._impactTime/.6,x=this._impactX*this._cameraScale+this._ox,y=-this._impactY*this._cameraScale+this._oy;c.globalAlpha=(1-t)*.8;c.strokeStyle='#f3e6a3';c.lineWidth=3;c.beginPath();c.arc(x,y,10+t*65,0,TAU);c.stroke();this._stats.drawOps++;c.globalAlpha=1;this._impactTime=Math.max(0,this._impactTime-dt);}

      if(this._flashTime>0){c.globalCompositeOperation='screen';c.globalAlpha=clamp(this._flashTime/this._flashDuration,0,1)*.16;c.fillStyle=this._flashColor;c.fillRect(0,0,w,h);c.globalAlpha=1;c.globalCompositeOperation='source-over';this._stats.drawOps++;this._flashTime=Math.max(0,this._flashTime-dt);}
    }
    render(frame=EMPTY){
      const start=performance.now();this._stats.drawOps=0;
      if(!this._biome||!this._banks.length){this.ctx.fillStyle='#152a2d';this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);this._stats.drawOps=1;this._stats.renderMs=performance.now()-start;return;}
      this._frame=frame;this._state=frame.state||EMPTY;this._input=frame.input||EMPTY;
      const dt=clamp(finite(frame.dt),0,.1);this._clock+=dt;this._worldClock+=Number.isFinite(frame.worldDt)?frame.worldDt:dt;this._kick*=Math.exp(-dt*19);this._muzzle=Math.max(0,this._muzzle-dt);
      this._preparePose(this._state,frame.pose);this._updateCamera(frame,dt);this._drawBackground();this._worldTransform();this._drawWorld();
      this._drawEntities();
      if(frame.ghost&&frame.ghost.pose&&frame.ghost.pose.length>=9){this.ctx.globalAlpha=.35*clamp(finite(frame.ghost.alpha,1),0,1);this._drawTruck(frame.ghost.pose,0,false,true);this.ctx.globalAlpha=1;}
      if(this._state.rival||Number.isFinite(this._pose[RIVAL*3]))this._drawTruck(this._pose,RIVAL*3,true);
      this._drawTruck(this._pose,PLAYER*3);this._drawCannon();this._emitAmbient(Number.isFinite(frame.worldDt)?frame.worldDt:dt);this._drawParticles(Number.isFinite(frame.worldDt)?frame.worldDt:dt);this._drawScreen(dt);
      this._stats.spriteBytes=this._spriteBytes+this._screenBytes;this._stats.renderScale=this.renderScale;this._stats.renderMs=performance.now()-start;
    }
  }
  global.IronRenderer=IronRenderer;
})(globalThis);
