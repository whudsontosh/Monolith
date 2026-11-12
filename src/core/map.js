
/* ============================== MONOLITH CORE: MAP ENGINE ============================== */
/* A canvas battle map in the spirit of Owlbear Rodeo: image + grid, tokens, fog, drawings, ruler, pings.
   The grid's own maths (square, hex, none; snapping; distance) lives in grid.js.
   World units are map-image pixels. The view never owns game state: it reads cfg.getMap() and reports
   what the user did through cfg.onEvent(type, data); the GM applies it, players send it to the GM. */
/* map look: games can restyle it with Monolith.theme.map */
function mapTheme(){const t=Monolith.theme.map||{};return {void:t.void||"#030303",corner:t.corner||"rgba(255,255,255,.7)",activeGlow:t.activeGlow||"rgba(255,255,255,.18)",font:t.font||'"Inter Tight","Segoe UI",sans-serif',
  mono:t.mono||'"JetBrains Mono",ui-monospace,monospace',select:t.select||"#ffffff",accent:t.accent||"#ffffff",label:t.label||"#f4f4f2",labelBg:t.labelBg||"rgba(3,3,3,.84)",previewBg:t.previewBg||"rgba(255,255,255,.92)",previewInk:t.previewInk||"#050505"}}
const INK_COLORS=["#ff4459","#f2a93b","#ffe14d","#4cc98c","#38d6f0","#7d95ff","#c77dff","#ffffff"];
const TOKEN_COLORS=["#c8102e","#2346d1","#18744a","#a76200","#6c2bd9","#0e7c86","#b3127a","#3d4352","#111318","#d9dbe3"];
function newMapData(o){return {id:uid(),name:o.name||"New map",asset:o.asset||null,w:o.w||2100,h:o.h||1400,bg:o.bg||"#1d2029",
  grid:{size:o.size||70,ox:0,oy:0,show:true,snap:true,color:"#ffffff",alpha:0.22,...Grid.defaults()},tokens:[],drawings:[],fog:{on:true,shapes:[]},created:Date.now()}}
function segDist(px,py,ax,ay,bx,by){const dx=bx-ax,dy=by-ay;const l=dx*dx+dy*dy;let t=l?((px-ax)*dx+(py-ay)*dy)/l:0;t=Math.max(0,Math.min(1,t));const x=ax+t*dx,y=ay+t*dy;return Math.hypot(px-x,py-y)}
function inPoly(x,y,p){let c=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2){const xi=p[i],yi=p[i+1],xj=p[j],yj=p[j+1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))c=!c}return c}

class MapView{
  constructor(cfg){
    this.cfg=cfg; // {role:'gm'|'player', getMap(), canMove(tok), canErase(d), canTpl(t), canPlaceTpl(), canState(tok), sight(), onEvent(type,data), imgUrl(asset), me(){return {color,name}}, ringFor(tok), activeTok()}
    this.el=document.createElement("div");this.el.className="mapview";this.el.tabIndex=0;
    this.canvas=document.createElement("canvas");this.el.appendChild(this.canvas);
    this.hud=document.createElement("div");this.hud.className="map-hud";this.el.appendChild(this.hud);
    this.ctx=this.canvas.getContext("2d");
    this.cam={x:0,y:0,z:1};this.cams={};this.mapId=null;
    this.tool="select";this.drawMode="pen";this.inkColor=INK_COLORS[0];this.inkWidth=4;
    this.lightSel=null;
    this.wallKind="wall";this.wallChain=null;this.wallCur=null;this.wallSel=null;
    this.tplShape="circle";this.tplPreset="";this.tplColor="#f2a93b";this.tplWidth=1;this.tplSel=null;this.tplDraft=null;
    this.sel=null;this.drag=null;this.ruler=null;this.poly=null;this.cur=null;this.preview=false;
    this.remoteRulers={};this.pings=[];this.imgs={};this.fogCv=document.createElement("canvas");this.fogKey="";
    this.dpr=1;this.cw=1;this.ch=1;this.raf=0;this.space=false;this.lastEmit=0;this.hover=null;
    this.camKey="monolith-map-cams-"+cfg.role;try{this.cams=JSON.parse(localStorage.getItem(this.camKey)||"{}")||{}}catch(e){this.cams={}}
    new ResizeObserver(()=>this.resize()).observe(this.el);
    const c=this.canvas;
    c.addEventListener("pointerdown",e=>this.down(e));
    c.addEventListener("pointermove",e=>this.move(e));
    c.addEventListener("pointerup",e=>this.up(e));
    c.addEventListener("pointercancel",e=>this.up(e));
    c.addEventListener("dblclick",e=>this.dbl(e));
    c.addEventListener("contextmenu",e=>e.preventDefault());
    c.addEventListener("wheel",e=>this.wheel(e),{passive:false});
    this.el.addEventListener("keydown",e=>this.key(e,true));
    this.el.addEventListener("keyup",e=>this.key(e,false));
    this.el.addEventListener("pointerenter",()=>{if(document.activeElement&&/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))return;this.el.focus({preventScroll:true})});
  }
  get map(){return this.cfg.getMap()}
  emit(t,d){try{this.cfg.onEvent(t,d)}catch(e){console.error(e)}}
  resize(){const r=this.el.getBoundingClientRect();if(!r.width||!r.height)return;this.dpr=window.devicePixelRatio||1;this.cw=r.width;this.ch=r.height;
    this.canvas.width=Math.round(r.width*this.dpr);this.canvas.height=Math.round(r.height*this.dpr);this.canvas.style.width=r.width+"px";this.canvas.style.height=r.height+"px";
    if(this.needFit){this.needFit=false;this.fit()}this.invalidate()}
  invalidate(){if(!this.raf)this.raf=requestAnimationFrame(()=>{this.raf=0;this.sync();this.draw()})}
  sync(){const m=this.map;const id=m?m.id:null;if(id!==this.mapId){if(this.mapId)this.saveCam();this.mapId=id;this.sel=null;this.poly=null;this.fogKey="";
      if(m){const c=this.cams[id];if(c&&isFinite(c.z)){this.cam={...c}}else if(this.cw>1)this.fit();else this.needFit=true}}}
  saveCam(){if(!this.mapId)return;this.cams[this.mapId]={...this.cam};clearTimeout(this.camT);this.camT=setTimeout(()=>{try{localStorage.setItem(this.camKey,JSON.stringify(this.cams))}catch(e){}},500)}
  fit(){const m=this.map;if(!m||this.cw<2)return;const pad=40;const z=Math.min((this.cw-pad*2)/m.w,(this.ch-pad*2)/m.h);this.cam.z=clamp(z,0.05,8);
    this.cam.x=m.w/2-this.cw/2/this.cam.z;this.cam.y=m.h/2-this.ch/2/this.cam.z;this.saveCam();this.invalidate()}
  zoomBy(f,sx=this.cw/2,sy=this.ch/2){const w=this.toWorld(sx,sy);this.cam.z=clamp(this.cam.z*f,0.05,8);this.cam.x=w.x-sx/this.cam.z;this.cam.y=w.y-sy/this.cam.z;this.saveCam();this.invalidate()}
  toWorld(sx,sy){return {x:sx/this.cam.z+this.cam.x,y:sy/this.cam.z+this.cam.y}}
  toScreen(wx,wy){return {x:(wx-this.cam.x)*this.cam.z,y:(wy-this.cam.y)*this.cam.z}}
  pt(e){const r=this.canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top}}
  setTool(t){this.tool=t;this.poly=null;this.cur=null;this.tplDraft=null;this.wallChain=null;this.wallCur=null;if(this.ruler&&this.ruler.path)this.endRuler(0);this.canvas.style.cursor=t==="pan"?"grab":t==="select"?"default":"crosshair";this.invalidate()}
  tokR(t){return Grid.tokR(this.map.grid,t.size)}
  visibleTokens(){const m=this.map;return (m.tokens||[])}
  hitToken(w){const ts=this.visibleTokens();for(let i=ts.length-1;i>=0;i--){const t=ts[i];if(this.cfg.role!=="gm"&&t.hidden)continue;if(Math.hypot(w.x-t.x,w.y-t.y)<=this.tokR(t))return t}return null}
  hitDrawing(w){const m=this.map;const tol=8/this.cam.z;const ds=m.drawings||[];
    for(let i=ds.length-1;i>=0;i--){const d=ds[i];const p=d.pts;if(d.type==="rect"&&p.length>=4){const [x1,y1,x2,y2]=p;const xs=[x1,x2].sort((a,b)=>a-b),ys=[y1,y2].sort((a,b)=>a-b);
        if(w.x>xs[0]-tol&&w.x<xs[1]+tol&&w.y>ys[0]-tol&&w.y<ys[1]+tol&&!(w.x>xs[0]+tol&&w.x<xs[1]-tol&&w.y>ys[0]+tol&&w.y<ys[1]-tol))return d;continue}
      for(let j=0;j+3<p.length;j+=2)if(segDist(w.x,w.y,p[j],p[j+1],p[j+2],p[j+3])<tol+(d.w||2)/2)return d}
    return null}
  /* ---- walls and doors (walls.js has the geometry) ---- */
  doors(){const m=this.map;return m?(m.doors||(m.walls||[]).filter(w=>w.kind==="door")):[]}
  hitDoor(w){const tol=13/this.cam.z;for(const d of this.doors()){const c=Walls.mid(d);if(Math.hypot(w.x-c.x,w.y-c.y)<tol&&!(this.cfg.role!=="gm"&&this.fogHides(this.map,c.x,c.y)))return d}return null}
  hitWall(w){const tol=7/this.cam.z;let best=null,bd=tol;for(const k of this.map.walls||[]){const d=segDist(w.x,w.y,k.a[0],k.a[1],k.b[0],k.b[1]);if(d<bd){bd=d;best=k}}return best}
  hitWallEnd(w){const tol=9/this.cam.z;for(const k of this.map.walls||[])for(const p of [k.a,k.b])if(Math.hypot(w.x-p[0],w.y-p[1])<tol)return {x:p[0],y:p[1],id:k.id};return null}
  /* ---- lights (the GM's; vision.js works out what they show) ---- */
  hitLight(w){const tol=13/this.cam.z,L=this.map.lights||[];for(let i=L.length-1;i>=0;i--)if(L[i]&&Math.hypot(w.x-L[i].x,w.y-L[i].y)<tol)return L[i];return null}
  endChain(){if(this.wallChain||this.wallCur){this.wallChain=null;this.wallCur=null;this.emit("wall-select",null);this.invalidate()}}
  /* ---- area templates (templates.js has the geometry) ---- */
  tpls(){const m=this.map;return (m&&m.templates)||[]}
  canTpl(t){return !!(this.cfg.canTpl&&this.cfg.canTpl(t))}
  /* the dot a pointer is on: a template's start (move it) or its far end (turn and resize it) */
  hitTpl(w){const g=this.map.grid,tol=11/this.cam.z,ts=this.tpls();
    for(let i=ts.length-1;i>=0;i--){const t=ts[i];if(!this.canTpl(t))continue;const e=Tpl.endPoint(t,g);
      if(Math.hypot(w.x-e.x,w.y-e.y)<tol)return {t,part:"end"};if(Math.hypot(w.x-t.x,w.y-t.y)<tol)return {t,part:"origin"}}
    return null}
  /* point a template from where it starts toward the pointer: sets its size (whole cells) and direction (15° steps) */
  aimTpl(t,w,free){const g=this.map.grid,s=Grid.size(g),snap=g.snap!==false&&Grid.type(g)!=="none";
    const o=t.o||t,dx=w.x-o.x,dy=w.y-o.y,cells=d=>snap?Math.max(1,Math.round(d/s)):Math.max(.25,Math.round(d/s*10)/10);
    if(t.shape==="square"){if(!t.fixed)t.size=cells(Math.max(Math.abs(dx),Math.abs(dy)));if(t.o){const L=t.size*s;t.x=dx<0?o.x-L:o.x;t.y=dy<0?o.y-L:o.y}return}
    if(!t.fixed)t.size=cells(Math.hypot(dx,dy));
    if(t.shape!=="circle"&&(dx||dy)){let a=Math.atan2(dy,dx);if(!free){const st=Math.PI/12;a=Math.round(a/st)*st}t.angle=a}}
  addPing(x,y,color){this.pings.push({x,y,color:color||"#ff4459",t:performance.now()});this.invalidate()}
  setRemoteRuler(by,data){if(!data)delete this.remoteRulers[by];else this.remoteRulers[by]={...data,t:performance.now()};this.invalidate()}

  /* ---------------- input ---------------- */
  down(e){
    const m=this.map;if(!m)return;this.el.focus({preventScroll:true});
    try{this.canvas.setPointerCapture(e.pointerId)}catch(_){}
    const p=this.pt(e),w=this.toWorld(p.x,p.y);
    this.emit("token-menu",null);
    if(e.button===1||e.button===2||this.space||this.tool==="pan"){const mt=e.button===2?this.hitToken(w):null;
      this.drag={k:"pan",sx:p.x,sy:p.y,cx:this.cam.x,cy:this.cam.y,menu:mt&&this.cfg.canState&&this.cfg.canState(mt)?mt.id:null};this.canvas.style.cursor="grabbing";return}
    if(e.button!==0)return;
    if(e.altKey||this.tool==="ping"){this.addPing(w.x,w.y,this.cfg.me().color);this.emit("ping",{x:w.x,y:w.y});return}
    const t=this.tool;
    if(t==="select"){const tok=this.hitToken(w);
      if(tok){this.sel=tok.id;this.emit("select",tok.id);
        if(this.cfg.canMove(tok))this.drag={k:"tok",id:tok.id,dx:w.x-tok.x,dy:w.y-tok.y,ox:tok.x,oy:tok.y,moved:false};
        this.invalidate();return}
      const door=this.hitDoor(w);if(door){this.emit("door",{id:door.id,lock:!!e.shiftKey});return}
      if(this.sel){this.sel=null;this.emit("select",null)}
      this.drag={k:"pan",sx:p.x,sy:p.y,cx:this.cam.x,cy:this.cam.y};this.canvas.style.cursor="grabbing";this.invalidate();return}
    if(t==="ruler"){const q=Grid.snapMeasure(m.grid,w.x,w.y);clearTimeout(this.rulerT);
      // Shift+click measures around corners: each Shift+click drops a point, a plain click ends the path
      if(e.shiftKey){if(this.ruler&&this.ruler.path){const P=this.ruler.pts;P[P.length-1]=q;if(P.length<13)P.push(q)}else this.ruler={path:true,pts:[q,q]};this.emitRuler(true);this.invalidate();return}
      if(this.ruler&&this.ruler.path){const P=this.ruler.pts;P[P.length-1]=q;this.emitRuler(true);this.endRuler(2600);this.invalidate();return}
      this.ruler={pts:[q,q]};this.drag={k:"ruler"};this.emitRuler(true);this.invalidate();return}
    if(t==="grid-fit"){this.drag={k:"fitrect",a:w,b:w};return}
    if(t==="lights"&&this.cfg.role==="gm"){const L=this.hitLight(w);
      if(L){this.lightSel=L.id;this.drag={k:"light",id:L.id,aim:!!e.shiftKey&&!!L.angle,moved:false};this.emit("light-select",L.id);this.invalidate();return}
      const q=e.shiftKey?{x:w.x,y:w.y}:Walls.snapEnd({walls:[],grid:m.grid},w.x,w.y,this.cam.z);this.emit("light-add",{x:q.x,y:q.y});return}
    if(t==="walls"&&this.cfg.role==="gm"){const z=this.cam.z;
      // not drawing yet: grab a wall's end (drag moves it, a click starts drawing from it), or pick a wall
      if(!this.wallChain){const end=e.shiftKey?null:this.hitWallEnd(w);
        if(end){this.wallSel=end.id;this.drag={k:"wallend",x:end.x,y:end.y,moved:false};this.emit("wall-select",end.id);this.invalidate();return}
        const k=this.hitWall(w);if(k){this.wallSel=k.id;this.emit("wall-select",k.id);this.invalidate();return}}
      const q=e.shiftKey?{x:w.x,y:w.y}:Walls.snapEnd(m,w.x,w.y,z),a=this.wallChain;
      if(a){if(Math.hypot(q.x-a.x,q.y-a.y)>=2){this.emit("wall-add",{a:[a.x,a.y],b:[q.x,q.y],kind:this.wallKind});this.wallChain=this.wallKind==="door"?null:q}}
      else{this.wallChain=q;this.wallSel=null;this.emit("wall-select",null)}
      this.wallCur=q;this.invalidate();return}
    if(t==="template"){const hit=this.hitTpl(w);
      if(hit){this.tplSel=hit.t.id;this.drag={k:hit.part==="end"?"tplaim":"tplmove",id:hit.t.id,dx:w.x-hit.t.x,dy:w.y-hit.t.y,moved:false};this.emit("tpl-select",hit.t.id);this.invalidate();return}
      if(this.cfg.canPlaceTpl&&!this.cfg.canPlaceTpl()){this.emit("tpl-denied");return}
      const o=Tpl.snapOrigin(m.grid,w.x,w.y),pre=Tpl.presets(m.grid).find(x=>x.id===this.tplPreset)||null;
      this.tplDraft={id:uid(),shape:pre?pre.shape:this.tplShape,x:o.x,y:o.y,size:pre?pre.size:0,width:pre?pre.width:Math.max(.25,Number(this.tplWidth)||1),angle:0,color:(pre&&pre.color)||this.tplColor,label:pre?pre.name:"",o};
      if(pre)this.tplDraft.fixed=true;this.drag={k:"tplnew",moved:false};this.invalidate();return}
    if(t==="draw"){
      if(this.drawMode==="erase"){const d=this.hitDrawing(w);if(d&&this.cfg.canErase(d))this.emit("draw-del",{id:d.id});this.drag={k:"erase"};return}
      this.cur={id:uid(),type:this.drawMode,color:this.inkColor,w:Math.max(0.5,this.inkWidth/this.cam.z),pts:[w.x,w.y,w.x,w.y]};this.drag={k:"draw"};this.invalidate();return}
    if(t==="fog-rect"||t==="fog-cut"){this.drag={k:"fogrect",a:w,b:w,op:t==="fog-cut"?"cut":"add"};return}
    if(t==="fog-poly"||t==="fog-cutpoly"){const op=t==="fog-cutpoly"?"cut":"add";
      if(!this.poly)this.poly={op,pts:[w.x,w.y]};
      else{const fx=this.poly.pts[0],fy=this.poly.pts[1];if(this.poly.pts.length>=6&&Math.hypot(w.x-fx,w.y-fy)*this.cam.z<12){this.finishPoly();return}this.poly.pts.push(w.x,w.y)}
      this.invalidate();return}
  }
  move(e){
    const p=this.pt(e),w=this.toWorld(p.x,p.y);this.mouse=w;const d=this.drag;const m=this.map;
    if(!d){if(this.poly)this.invalidate();
      if(this.wallChain&&m){this.wallCur=e.shiftKey?{x:w.x,y:w.y}:Walls.snapEnd(m,w.x,w.y,this.cam.z);this.invalidate()}
      if(this.ruler&&this.ruler.path&&m){const P=this.ruler.pts;P[P.length-1]=Grid.snapMeasure(m.grid,w.x,w.y);this.emitRuler(false);this.invalidate()}
      if(this.tool==="select"&&m){const tok=this.hitToken(w);const id=tok?tok.id:null;if(id!==this.hover){this.hover=id;this.canvas.style.cursor=tok&&this.cfg.canMove(tok)?"grab":"default";this.invalidate()}}
      return}
    if(d.k==="pan"){if(Math.hypot(p.x-d.sx,p.y-d.sy)>4)d.menu=null;this.cam.x=d.cx-(p.x-d.sx)/this.cam.z;this.cam.y=d.cy-(p.y-d.sy)/this.cam.z;this.invalidate();return}
    if(d.k==="tok"){const tok=(m.tokens||[]).find(x=>x.id===d.id);if(!tok){this.drag=null;return}
      tok.x=clamp(w.x-d.dx,0,m.w);tok.y=clamp(w.y-d.dy,0,m.h);d.moved=true;this.canvas.style.cursor="grabbing";
      const now=performance.now();if(now-this.lastEmit>45){this.lastEmit=now;this.emit("move",{id:tok.id,x:tok.x,y:tok.y,final:false})}
      this.invalidate();return}
    if(d.k==="ruler"){const P=this.ruler.pts;P[P.length-1]=Grid.snapMeasure(m.grid,w.x,w.y);this.emitRuler(false);this.invalidate();return}
    if(d.k==="erase"){const dr=this.hitDrawing(w);if(dr&&this.cfg.canErase(dr))this.emit("draw-del",{id:dr.id});return}
    if(d.k==="draw"&&this.cur){const pts=this.cur.pts;
      if(this.cur.type==="pen"){const lx=pts[pts.length-2],ly=pts[pts.length-1];if(Math.hypot(w.x-lx,w.y-ly)*this.cam.z>=2.5&&pts.length<4000)pts.push(+w.x.toFixed(1),+w.y.toFixed(1))}
      else{pts[2]=w.x;pts[3]=w.y}
      this.invalidate();return}
    if(d.k==="fogrect"||d.k==="fitrect"){d.b=w;this.invalidate();return}
    if(d.k==="light"){const l=(m.lights||[]).find(x=>x&&x.id===d.id);if(!l){this.drag=null;return}
      if(d.aim)l.dir=Math.atan2(w.y-l.y,w.x-l.x);else{const q=e.shiftKey?{x:w.x,y:w.y}:Walls.snapEnd({walls:[],grid:m.grid},w.x,w.y,this.cam.z);l.x=q.x;l.y=q.y}
      d.moved=true;this.invalidate();return}
    if(d.k==="wallend"){if(!d.moved&&Math.hypot(w.x-d.x,w.y-d.y)*this.cam.z<5)return;
      // every wall that ends at this point moves with it
      if(!d.ends){d.ends=[];for(const k of m.walls||[])for(const en of ["a","b"])if(Math.hypot(k[en][0]-d.x,k[en][1]-d.y)<.6)d.ends.push([k.id,en])}
      const q=e.shiftKey?{x:w.x,y:w.y}:Walls.snapEnd(m,w.x,w.y,this.cam.z,new Set(d.ends.map(x=>x[0])));
      for(const [id,en] of d.ends){const k=(m.walls||[]).find(x=>x.id===id);if(k)k[en]=[q.x,q.y]}
      d.x=q.x;d.y=q.y;d.moved=true;this.invalidate();return}
    if(d.k==="tplnew"&&this.tplDraft){this.aimTpl(this.tplDraft,w,e.shiftKey);d.moved=true;this.invalidate();return}
    if(d.k==="tplaim"||d.k==="tplmove"){const t=this.tpls().find(x=>x.id===d.id);if(!t){this.drag=null;return}
      if(d.k==="tplaim")this.aimTpl(t,w,e.shiftKey);else{const o=Tpl.snapOrigin(m.grid,w.x-d.dx,w.y-d.dy);t.x=o.x;t.y=o.y}
      d.moved=true;d.last={id:t.id,x:t.x,y:t.y,size:t.size,width:t.width,angle:t.angle};this.invalidate();return}
  }
  /* a finished measurement stays on screen for a moment, then clears for everyone */
  endRuler(ms){if(this.ruler)this.ruler.path=false;clearTimeout(this.rulerT);const clear=()=>{this.ruler=null;this.emit("ruler",null);this.invalidate()};if(ms>0)this.rulerT=setTimeout(clear,ms);else clear()}
  up(e){
    const d=this.drag;this.drag=null;const m=this.map;
    if(this.tool==="pan")this.canvas.style.cursor="grab";else if(this.tool==="select")this.canvas.style.cursor="default";
    if(!d||!m)return;
    if(d.k==="pan"){this.saveCam();if(d.menu)this.emit("token-menu",{id:d.menu,x:d.sx,y:d.sy});return}
    if(d.k==="tok"){const tok=(m.tokens||[]).find(x=>x.id===d.id);if(!tok)return;
      if(!d.moved){this.invalidate();return}
      if(m.grid.snap!==false){const s=Grid.snap(m.grid,tok.x,tok.y,tok.size);tok.x=clamp(s.x,0,m.w);tok.y=clamp(s.y,0,m.h)}
      this.emit("move",{id:tok.id,x:Math.round(tok.x),y:Math.round(tok.y),final:true});this.invalidate();return}
    if(d.k==="ruler"){this.endRuler(1600);return}
    if(d.k==="light"){const l=(m.lights||[]).find(x=>x&&x.id===d.id);if(l&&d.moved)this.emit("light-set",{id:l.id,x:l.x,y:l.y,dir:l.dir||0});this.invalidate();return}
    if(d.k==="wallend"){if(d.moved){const ids=d.ends.map(x=>x[0]);this.emit("wall-set",(m.walls||[]).filter(k=>ids.includes(k.id)).map(k=>({id:k.id,a:k.a,b:k.b})))}
      else{this.wallChain={x:d.x,y:d.y};this.wallCur=this.wallChain;this.wallSel=null;this.emit("wall-select",null)}
      this.invalidate();return}
    if(d.k==="tplnew"){const t=this.tplDraft;this.tplDraft=null;if(t&&(t.fixed||(d.moved&&t.size>0))){delete t.o;this.tplSel=t.id;this.emit("tpl-add",t)}this.invalidate();return}
    if(d.k==="tplaim"||d.k==="tplmove"){if(d.moved&&d.last)this.emit("tpl-set",d.last);this.invalidate();return}
    if(d.k==="fitrect"){if(Math.abs(d.b.x-d.a.x)*this.cam.z>8&&Math.abs(d.b.y-d.a.y)*this.cam.z>8)this.emit("grid-fit",{x1:d.a.x,y1:d.a.y,x2:d.b.x,y2:d.b.y});this.invalidate();return}
    if(d.k==="draw"&&this.cur){const c=this.cur;this.cur=null;const p=c.pts;
      const len=p.length>=4?Math.hypot(p[p.length-2]-p[0],p[p.length-1]-p[1]):0;
      if(c.type==="pen"?p.length>=4:len*this.cam.z>3){c.pts=p.map(v=>+(+v).toFixed(1));this.emit("draw-add",c)}
      this.invalidate();return}
    if(d.k==="fogrect"){const x1=Math.min(d.a.x,d.b.x),y1=Math.min(d.a.y,d.b.y),x2=Math.max(d.a.x,d.b.x),y2=Math.max(d.a.y,d.b.y);
      if((x2-x1)*this.cam.z>4&&(y2-y1)*this.cam.z>4)this.emit("fog-add",{id:uid(),op:d.op,type:"rect",pts:[x1,y1,x2,y2].map(v=>Math.round(v))});
      this.invalidate();return}
  }
  finishPoly(){const p=this.poly;this.poly=null;if(p&&p.pts.length>=6)this.emit("fog-add",{id:uid(),op:p.op,type:"poly",pts:p.pts.map(v=>Math.round(v))});this.invalidate()}
  dbl(e){const m=this.map;if(!m)return;if(this.tool==="walls"){this.endChain();return}const p=this.pt(e),w=this.toWorld(p.x,p.y);
    if(this.tool==="fog-poly"||this.tool==="fog-cutpoly"){if(this.poly&&this.poly.pts.length>=8){this.poly.pts.splice(-2,2);this.finishPoly()}return}
    if(this.tool!=="select")return;const tok=this.hitToken(w);
    if(tok){this.emit("token-dbl",tok.id);return}
    this.addPing(w.x,w.y,this.cfg.me().color);this.emit("ping",{x:w.x,y:w.y})}
  wheel(e){e.preventDefault();const p=this.pt(e);const dy=e.deltaMode===1?e.deltaY*16:e.deltaY;const f=Math.exp(-Math.max(-300,Math.min(300,dy))*(e.ctrlKey?0.01:0.0015));this.zoomBy(f,p.x,p.y)}
  key(e,isDown){
    if(e.code==="Space"){this.space=isDown;if(isDown&&!this.drag)this.canvas.style.cursor="grab";e.preventDefault();return}
    if(!isDown)return;
    if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
    const k=e.key.toLowerCase();
    if((k==="escape"||k==="enter")&&this.wallChain){this.endChain();return}
    if(k==="escape"&&this.tool==="walls"&&this.wallSel){this.wallSel=null;this.emit("wall-select",null);this.invalidate();return}
    if((k==="delete"||k==="backspace")&&this.tool==="lights"&&this.lightSel){const id=this.lightSel;this.lightSel=null;this.emit("light-del",id);return}
    if((k==="delete"||k==="backspace")&&this.tool==="walls"&&this.wallSel){const id=this.wallSel;this.wallSel=null;this.emit("wall-del",id);return}
    if(k==="escape"){if(this.ruler&&this.ruler.path){this.endRuler(0)}else if(this.poly){this.poly=null;this.invalidate()}else if(this.sel){this.sel=null;this.emit("select",null);this.invalidate()}return}
    if(k==="enter"&&this.poly){this.finishPoly();return}
    if((k==="delete"||k==="backspace")&&this.tool==="template"&&this.tplSel){const id=this.tplSel;this.tplSel=null;this.emit("tpl-del",id);return}
    if((k==="delete"||k==="backspace")&&this.sel){this.emit("token-del",this.sel);return}
    if(k==="+"||k==="="){this.zoomBy(1.2);return}
    if(k==="-"||k==="_"){this.zoomBy(1/1.2);return}
    if(k==="0"){this.fit();return}
    const map={v:"select",h:"pan",r:"ruler",d:"draw",p:"ping",t:"template"};if(this.cfg.role==="gm"){map.f="fog-rect";map.w="walls";map.l="lights"}
    if(map[k]&&!e.ctrlKey&&!e.metaKey){this.emit("tool",map[k])}
  }
  emitRuler(force){const now=performance.now();if(!force&&now-this.lastRuler<60)return;this.lastRuler=now;const r=this.ruler;if(!r)return;
    const P=r.pts,n=P.length,xy=q=>[Math.round(q.x),Math.round(q.y)],via=[];for(let i=1;i<n-1;i++)via.push(...xy(P[i]));
    this.emit("ruler",{a:xy(P[0]),b:xy(P[n-1]),via})}

  /* ---------------- drawing ---------------- */
  img(asset){if(!asset)return null;const k=asset.id||asset;let im=this.imgs[k];
    if(!im){im=new Image();im.decoding="async";im.onload=()=>this.invalidate();im.onerror=()=>{im.failed=true;this.invalidate()};im.src=this.cfg.imgUrl(k);this.imgs[k]=im}
    return im.complete&&im.naturalWidth?im:null}
  fogLayer(m){const shapes=(m.fog&&m.fog.shapes)||[];const key=m.id+":"+m.w+"x"+m.h+":"+JSON.stringify(shapes);if(key===this.fogKey)return this.fogCv;this.fogKey=key;
    const sc=Math.min(1,2048/Math.max(m.w,m.h));const cv=this.fogCv;cv.width=Math.max(1,Math.ceil(m.w*sc));cv.height=Math.max(1,Math.ceil(m.h*sc));
    const c=cv.getContext("2d");c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,cv.width,cv.height);c.setTransform(sc,0,0,sc,0,0);
    for(const s of shapes){c.globalCompositeOperation=s.op==="cut"?"destination-out":"source-over";c.fillStyle="#000";c.beginPath();
      if(s.type==="rect"){const [x1,y1,x2,y2]=s.pts;c.rect(x1,y1,x2-x1,y2-y1)}else{const p=s.pts;c.moveTo(p[0],p[1]);for(let i=2;i<p.length;i+=2)c.lineTo(p[i],p[i+1]);c.closePath()}
      c.fill()}
    c.globalCompositeOperation="source-over";return cv}
  fogHides(m,x,y){const shapes=(m.fog&&m.fog.on&&m.fog.shapes)||[];let hidden=false;
    for(const s of shapes){let inside;if(s.type==="rect"){const [x1,y1,x2,y2]=s.pts;inside=x>=x1&&x<=x2&&y>=y1&&y<=y2}else inside=inPoly(x,y,s.pts);if(inside)hidden=s.op!=="cut"}
    return hidden}
  draw(){
    const c=this.ctx,dpr=this.dpr,W=this.cw,H=this.ch,m=this.map,z=this.cam.z;
    const TH=mapTheme();c.setTransform(dpr,0,0,dpr,0,0);c.fillStyle=TH.void;c.fillRect(0,0,W,H);
    if(!m){this.hud.textContent="";return}
    const playerView=this.cfg.role!=="gm"||this.preview;
    c.setTransform(dpr*z,0,0,dpr*z,-this.cam.x*dpr*z,-this.cam.y*dpr*z);
    // map surface
    c.fillStyle=m.bg||"#1d2029";c.fillRect(0,0,m.w,m.h);
    const im=this.img(m.asset);if(im){c.imageSmoothingEnabled=true;c.imageSmoothingQuality="high";c.drawImage(im,0,0,m.w,m.h)}
    // grid
    const g=m.grid||{};if(g.show!==false&&Grid.type(g)!=="none"){const s=Grid.size(g),hex=Grid.isHex(g);
      const v0=this.toWorld(0,0),v1=this.toWorld(W,H);const x0=Math.max(0,v0.x),x1=Math.min(m.w,v1.x),y0=Math.max(0,v0.y),y1=Math.min(m.h,v1.y);
      if(s*z>=(hex?7:5)&&x1>x0&&y1>y0){c.save();if(hex){c.beginPath();c.rect(0,0,m.w,m.h);c.clip()}
        c.beginPath();Grid.path(c,g,x0,y0,x1,y1);
        c.strokeStyle=g.color||"#fff";c.globalAlpha=clamp(Number(g.alpha??0.22),0.03,1);c.lineWidth=1/z;c.stroke();c.restore()}}
    // HUD corner marks around the map edge
    {const L=Math.min(m.w,m.h)*0.04+14/z;c.strokeStyle=TH.corner;c.lineWidth=2/z;c.beginPath();
      [[0,0,1,1],[m.w,0,-1,1],[0,m.h,1,-1],[m.w,m.h,-1,-1]].forEach(([x,y,sx,sy])=>{c.moveTo(x+sx*L,y);c.lineTo(x,y);c.lineTo(x,y+sy*L)});c.stroke()}
    // drawings
    const strokeD=d=>{const p=d.pts;if(!p||p.length<4)return;c.strokeStyle=d.color||"#fff";c.lineWidth=d.w||3;c.lineCap="round";c.lineJoin="round";c.beginPath();
      if(d.type==="rect"){c.rect(p[0],p[1],p[2]-p[0],p[3]-p[1])}else if(d.type==="circle"){c.arc(p[0],p[1],Math.hypot(p[2]-p[0],p[3]-p[1]),0,Math.PI*2)}else{c.moveTo(p[0],p[1]);for(let i=2;i<p.length;i+=2)c.lineTo(p[i],p[i+1])}
      c.stroke()};
    (m.drawings||[]).forEach(strokeD);if(this.cur)strokeD(this.cur);
    // tokens
    const me=this.cfg.me();const active=this.cfg.activeTok?this.cfg.activeTok():null;const now=performance.now();
    const labels=[];const caughtBy=new Map();
    const sight=playerView&&this.cfg.sight?this.cfg.sight():null; // light and sight: what this viewer sees now and has seen
    const drawTok=(t)=>{const r=this.tokR(t);const hidden=t.hidden;if(hidden&&this.cfg.role!=="gm")return;
      if(sight&&sight.sees&&!sight.sees(t))return;
      c.save();if(hidden)c.globalAlpha=0.45;
      if(t.id===active){c.beginPath();c.arc(t.x,t.y,r+Math.max(6/z,r*0.18),0,Math.PI*2);c.fillStyle=TH.activeGlow;c.fill()}
      c.beginPath();c.arc(t.x,t.y,r*0.94,0,Math.PI*2);c.fillStyle=t.color||"#3d4352";c.fill();
      const ti=t.img?this.img(t.img):null;
      if(ti){c.save();c.beginPath();c.arc(t.x,t.y,r*0.88,0,Math.PI*2);c.clip();const s=Math.max((r*2)/ti.naturalWidth,(r*2)/ti.naturalHeight);c.drawImage(ti,t.x-ti.naturalWidth*s/2,t.y-ti.naturalHeight*s/2,ti.naturalWidth*s,ti.naturalHeight*s);c.restore()}
      else{c.fillStyle="#fff";c.font=`700 ${Math.round(r*1.15)}px ${TH.font}`;c.textAlign="center";c.textBaseline="middle";c.fillText(String(t.label||"?").trim().charAt(0).toUpperCase()||"?",t.x,t.y+r*0.04)}
      c.lineWidth=Math.max(1.5/z,r*0.07);c.strokeStyle="rgba(255,255,255,.9)";c.beginPath();c.arc(t.x,t.y,r*0.94,0,Math.PI*2);c.stroke();
      const ring=this.cfg.ringFor?this.cfg.ringFor(t):null;
      if(ring&&ring.color){c.lineWidth=Math.max(3/z,r*0.14);c.strokeStyle=ring.color;c.beginPath();c.arc(t.x,t.y,r*1.04,-Math.PI/2,-Math.PI/2+Math.PI*2*clamp(ring.frac??1,0.05,1));c.stroke();
        if(ring.dead){c.strokeStyle="#ff4459";c.lineWidth=Math.max(2/z,r*0.12);c.beginPath();c.moveTo(t.x-r*0.6,t.y-r*0.6);c.lineTo(t.x+r*0.6,t.y+r*0.6);c.moveTo(t.x+r*0.6,t.y-r*0.6);c.lineTo(t.x-r*0.6,t.y+r*0.6);c.stroke()}}
      const cs=Cond.cleanConds(t.conds);
      if(cs.length&&r*z>=9){const br=clamp(r*0.3,6.5/z,15/z),show=cs.length>6?5:cs.length;c.setLineDash([]);
        for(let i=0;i<(cs.length>6?6:show);i++){const a=-1.05+i*Math.min(0.66,2.4*br/r),bx=t.x+Math.cos(a)*r*1.02,by=t.y+Math.sin(a)*r*1.02,more=i>=show,k=more?null:Cond.get(cs[i].id);
          c.beginPath();c.arc(bx,by,br,0,Math.PI*2);c.fillStyle=more?"#0b0c11":k.color;c.fill();c.lineWidth=Math.max(1/z,br*0.14);c.strokeStyle="#0b0c11";c.stroke();
          const ip=more?null:Cond.path(k);
          if(ip){c.save();c.translate(bx,by);c.scale(br*1.25/12,br*1.25/12);c.translate(-12,-12);c.lineWidth=2.6;c.lineCap="round";c.lineJoin="round";c.strokeStyle="#fff";c.stroke(ip);c.restore()}
          else{c.fillStyle="#fff";c.font=`700 ${br*(more?0.95:1.0)}px ${TH.font}`;c.textAlign="center";c.textBaseline="middle";c.fillText(more?"+"+(cs.length-show):k.name.slice(0,2),bx,by+br*0.06)}
          if(!more&&cs[i].rounds&&br*z>=8){const tx=bx+br*0.85,ty=by+br*0.9;c.font=`700 ${br*0.95}px ${TH.mono}`;c.textAlign="center";c.textBaseline="middle";c.lineWidth=br*0.3;c.strokeStyle="#0b0c11";c.strokeText(String(cs[i].rounds),tx,ty);c.fillStyle="#fff";c.fillText(String(cs[i].rounds),tx,ty)}}}
      if(caughtBy.has(t.id)){c.setLineDash([]);c.lineWidth=Math.max(3/z,r*0.1);c.strokeStyle=caughtBy.get(t.id);c.beginPath();c.arc(t.x,t.y,r*1.3,0,Math.PI*2);c.stroke()}
      if(t.id===this.sel||t.id===this.hover){c.setLineDash([6/z,4/z]);c.lineWidth=2/z;c.strokeStyle=t.id===this.sel?TH.select:"rgba(255,255,255,.6)";c.beginPath();c.arc(t.x,t.y,r*1.18,0,Math.PI*2);c.stroke();c.setLineDash([])}
      if(hidden&&this.cfg.role==="gm"){c.globalAlpha=1;c.fillStyle="#0b0c11";c.font=`${Math.max(9/z,r*0.3)}px ${TH.mono}`;c.textAlign="center";c.fillText("HIDDEN",t.x,t.y-r*1.3)}
      c.restore();
      labels.push(t)};
    const mine=t=>t.owner&&t.owner===me.playerId;
    const toks=m.tokens||[];
    // doors: everyone sees where they are and whether they stand open
    for(const d of this.doors()){const cm=Walls.mid(d);if(playerView||this.cfg.role!=="gm"){if(this.fogHides(m,cm.x,cm.y))continue}
      let ax=d.a[0],ay=d.a[1],bx=d.b[0],by=d.b[1];if(d.open){const co=Math.cos(1.25),si=Math.sin(1.25),dx=bx-ax,dy=by-ay;bx=ax+dx*co-dy*si;by=ay+dx*si+dy*co}
      c.save();c.lineCap="round";c.strokeStyle="#0b0c11";c.lineWidth=8/z;c.beginPath();c.moveTo(ax,ay);c.lineTo(bx,by);c.stroke();
      c.strokeStyle=d.open?"#4cc98c":"#ff7a3c";c.lineWidth=4.5/z;c.setLineDash(d.open?[7/z,6/z]:[]);c.beginPath();c.moveTo(ax,ay);c.lineTo(bx,by);c.stroke();c.setLineDash([]);
      c.fillStyle=d.locked&&!playerView?"#ff4459":d.open?"#4cc98c":"#ff7a3c";c.strokeStyle="#0b0c11";c.lineWidth=2/z;c.beginPath();c.arc(cm.x,cm.y,(d.locked&&!playerView?7:5.5)/z,0,Math.PI*2);c.fill();c.stroke();
      if(d.locked&&!playerView){c.strokeStyle="#fff";c.lineWidth=1.6/z;c.beginPath();c.moveTo(cm.x-3/z,cm.y-3/z);c.lineTo(cm.x+3/z,cm.y+3/z);c.moveTo(cm.x+3/z,cm.y-3/z);c.lineTo(cm.x-3/z,cm.y+3/z);c.stroke()}
      c.restore()}
    // the GM's lights: only while the Lights tool is in hand
    if(this.tool==="lights"&&this.cfg.role==="gm"&&!playerView){const per=Grid.per(g),gs=Grid.size(g);c.save();
      for(const l of m.lights||[]){if(!l||l.bright==null)continue;const on=l.id===this.lightSel,R=(l.bright+l.dim)/per*gs,B=l.bright/per*gs,a0=l.angle?(l.dir||0)-l.angle*Math.PI/360:0,a1=l.angle?(l.dir||0)+l.angle*Math.PI/360:Math.PI*2;
        c.strokeStyle=l.color;c.globalAlpha=on?1:.7;c.lineWidth=(on?2.5:1.5)/z;c.setLineDash([9/z,7/z]);c.beginPath();if(l.angle)c.moveTo(l.x,l.y);c.arc(l.x,l.y,R,a0,a1);if(l.angle)c.closePath();c.stroke();
        c.setLineDash([]);if(B>0&&B<R){c.globalAlpha=on?.8:.45;c.beginPath();c.arc(l.x,l.y,B,a0,a1);c.stroke()}
        c.globalAlpha=1;c.fillStyle="#0b0c11";c.beginPath();c.arc(l.x,l.y,9/z,0,Math.PI*2);c.fill();c.fillStyle=l.color;c.beginPath();c.arc(l.x,l.y,6/z,0,Math.PI*2);c.fill();
        if(on){c.strokeStyle="#fff";c.lineWidth=2/z;c.beginPath();c.arc(l.x,l.y,10.5/z,0,Math.PI*2);c.stroke()}}
      c.restore()}
    // the GM's walls: only while the Walls tool is in hand
    if(this.tool==="walls"&&this.cfg.role==="gm"&&!playerView){c.save();c.lineCap="round";
      for(const k of m.walls||[]){const L=Walls.LOOK[k.kind]||Walls.LOOK.wall,on=k.id===this.wallSel;c.strokeStyle="#0b0c11";c.lineWidth=(on?8:6)/z;c.setLineDash([]);c.beginPath();c.moveTo(k.a[0],k.a[1]);c.lineTo(k.b[0],k.b[1]);c.stroke();
        c.strokeStyle=on?"#ffffff":L.color;c.lineWidth=(on?4.5:3)/z;c.setLineDash(L.dash?[9/z,7/z]:[]);c.beginPath();c.moveTo(k.a[0],k.a[1]);c.lineTo(k.b[0],k.b[1]);c.stroke()}
      c.setLineDash([]);for(const k of m.walls||[])for(const q of [k.a,k.b]){c.fillStyle="#0b0c11";c.beginPath();c.arc(q[0],q[1],4.5/z,0,Math.PI*2);c.fill();c.fillStyle=(Walls.LOOK[k.kind]||Walls.LOOK.wall).color;c.beginPath();c.arc(q[0],q[1],3/z,0,Math.PI*2);c.fill()}
      if(this.wallChain&&this.wallCur){const L=Walls.LOOK[this.wallKind];c.strokeStyle=L.color;c.globalAlpha=.8;c.lineWidth=3/z;c.setLineDash([6/z,5/z]);c.beginPath();c.moveTo(this.wallChain.x,this.wallChain.y);c.lineTo(this.wallCur.x,this.wallCur.y);c.stroke();
        c.setLineDash([]);c.globalAlpha=1;c.fillStyle="#fff";c.beginPath();c.arc(this.wallChain.x,this.wallChain.y,4/z,0,Math.PI*2);c.fill()}
      c.restore()}
    // area templates: under the tokens; whoever they catch gets a ring in the template's color
    const tplInfo=[];{const list=(m.templates||[]).slice();if(this.tplDraft&&this.tplDraft.size>0)list.push(this.tplDraft);
      const seen=toks.filter(t=>!(t.hidden&&(playerView||this.cfg.role!=="gm"))&&!(playerView&&!mine(t)&&this.fogHides(m,t.x,t.y)));
      const byCells=Tpl.rule()==="cells"&&Grid.type(g)!=="none",editing=this.tool==="template";
      for(const t of list){const o=Tpl.outline(t,g);c.save();c.beginPath();o.forEach((q,i)=>i?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y));c.closePath();
        c.fillStyle=t.color;c.globalAlpha=byCells?.07:.17;c.fill();
        if(byCells){c.globalAlpha=.2;c.beginPath();for(const k of Tpl.cells(t,g)){Grid.corners(g,k).forEach((q,i)=>i?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y));c.closePath()}c.fill();
          c.beginPath();o.forEach((q,i)=>i?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y));c.closePath()}
        c.globalAlpha=.95;c.strokeStyle=t.color;c.lineWidth=(t.id===this.tplSel&&editing?3:2)/z;c.lineJoin="round";c.stroke();
        if(editing&&(t===this.tplDraft||this.canTpl(t))){const e=Tpl.endPoint(t,g);c.fillStyle=t.color;c.beginPath();c.arc(t.x,t.y,6/z,0,Math.PI*2);c.fill();
          c.fillStyle="#fff";c.strokeStyle=t.color;c.lineWidth=2/z;c.beginPath();c.rect(e.x-5/z,e.y-5/z,10/z,10/z);c.fill();c.stroke()}
        c.restore();
        const got=Tpl.caught(t,g,seen);got.forEach(k=>{if(!caughtBy.has(k.id))caughtBy.set(k.id,t.color)});tplInfo.push({t,got})}}
    for(const t of toks){if(!t.auras||(t.hidden&&(playerView||this.cfg.role!=="gm"))||(playerView&&!mine(t)&&this.fogHides(m,t.x,t.y)))continue;
      for(const a of Cond.cleanAuras(t.auras)){if(a.see==="gm"?(this.cfg.role!=="gm"||playerView):a.see==="owner"?!(mine(t)||(this.cfg.role==="gm"&&!playerView)):false)continue;
        const R=Cond.auraR(g,t,a);c.save();c.beginPath();c.arc(t.x,t.y,R,0,Math.PI*2);c.fillStyle=a.color;c.globalAlpha=.1;c.fill();c.globalAlpha=.75;c.strokeStyle=a.color;c.lineWidth=2/z;c.setLineDash([10/z,7/z]);c.stroke();c.restore()}}
    toks.filter(t=>!(playerView&&mine(t))).forEach(drawTok);
    // fog
    if(m.fog&&m.fog.on&&(m.fog.shapes||[]).length){const fc=this.fogLayer(m);c.save();c.globalAlpha=playerView?1:0.55;c.imageSmoothingEnabled=true;c.drawImage(fc,0,0,m.w,m.h);c.restore()}
    // darkness: black where the party has never been, dimmed where it has, clear where this viewer sees now
    if(sight){if(sight.vis||sight.seen)Vision.drawDark(c,m,sight.vis,sight.seen);else{c.fillStyle="#04050a";c.fillRect(0,0,m.w,m.h)}}
    const ownLabels=[];
    if(playerView){const before=labels.length;toks.filter(mine).forEach(drawTok);ownLabels.push(...labels.splice(before))}
    // fog editing previews
    if(this.drag&&this.drag.k==="fogrect"){const d=this.drag;c.save();c.fillStyle=d.op==="cut"?"rgba(76,201,140,.25)":"rgba(0,0,0,.45)";c.strokeStyle=d.op==="cut"?"#4cc98c":"#ff4459";c.lineWidth=2/z;c.setLineDash([8/z,5/z]);
      c.fillRect(d.a.x,d.a.y,d.b.x-d.a.x,d.b.y-d.a.y);c.strokeRect(d.a.x,d.a.y,d.b.x-d.a.x,d.b.y-d.a.y);c.restore()}
    if(this.drag&&this.drag.k==="fitrect"){const d=this.drag;c.save();c.fillStyle="rgba(56,214,240,.14)";c.strokeStyle="#38d6f0";c.lineWidth=2/z;c.setLineDash([8/z,5/z]);
      c.fillRect(d.a.x,d.a.y,d.b.x-d.a.x,d.b.y-d.a.y);c.strokeRect(d.a.x,d.a.y,d.b.x-d.a.x,d.b.y-d.a.y);c.restore()}
    if(this.poly){const p=this.poly.pts;c.save();c.strokeStyle=this.poly.op==="cut"?"#4cc98c":"#ff4459";c.lineWidth=2/z;c.setLineDash([8/z,5/z]);c.beginPath();c.moveTo(p[0],p[1]);for(let i=2;i<p.length;i+=2)c.lineTo(p[i],p[i+1]);
      if(this.mouse)c.lineTo(this.mouse.x,this.mouse.y);c.stroke();c.setLineDash([]);c.fillStyle=c.strokeStyle;for(let i=0;i<p.length;i+=2){c.beginPath();c.arc(p[i],p[i+1],(i===0?6:3.5)/z,0,Math.PI*2);c.fill()}c.restore()}
    // pings
    this.pings=this.pings.filter(pg=>now-pg.t<2200);
    for(const pg of this.pings){const a=(now-pg.t)/2200;c.save();c.strokeStyle=pg.color;for(let k=0;k<2;k++){const aa=(a+k*0.35)%1;c.globalAlpha=1-aa;c.lineWidth=3/z;c.beginPath();c.arc(pg.x,pg.y,(10+aa*60)/z,0,Math.PI*2);c.stroke()}
      c.globalAlpha=1;c.fillStyle=pg.color;c.beginPath();c.arc(pg.x,pg.y,5/z,0,Math.PI*2);c.fill();c.restore()}
    // rulers (world lines)
    const rulers=[];if(this.ruler)rulers.push({pts:this.ruler.pts,color:me.color||"#38d6f0",name:""});
    for(const k in this.remoteRulers){const r=this.remoteRulers[k];if(now-r.t>8000){delete this.remoteRulers[k];continue}
      const pts=[{x:r.a[0],y:r.a[1]}],v=Array.isArray(r.via)?r.via:[];for(let i=0;i+1<v.length&&i<24;i+=2)pts.push({x:Number(v[i])||0,y:Number(v[i+1])||0});pts.push({x:r.b[0],y:r.b[1]});
      rulers.push({pts,color:r.color||"#f2a93b",name:r.name||""})}
    for(const r of rulers){c.save();c.strokeStyle=r.color;c.lineWidth=3/z;c.setLineDash([10/z,6/z]);c.beginPath();r.pts.forEach((q,i)=>i?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y));c.stroke();c.setLineDash([]);c.fillStyle=r.color;
      r.pts.forEach(q=>{c.beginPath();c.arc(q.x,q.y,5/z,0,Math.PI*2);c.fill()});c.restore()}
    // screen-space overlays: labels + ruler readouts
    c.setTransform(dpr,0,0,dpr,0,0);
    const label=(t)=>{if(t.hidden&&this.cfg.role!=="gm")return;if(playerView&&!mine(t)&&this.fogHides(m,t.x,t.y))return;const r=this.tokR(t);const s=this.toScreen(t.x,t.y+r*1.02);
      if(s.x<-80||s.x>W+80||s.y<-40||s.y>H+40)return;const text=String(t.label||"");if(!text)return;
      c.font=`700 13px ${TH.font}`;const w=c.measureText(text).width+10;c.fillStyle=TH.labelBg;c.fillRect(Math.round(s.x-w/2),Math.round(s.y+3),Math.round(w),17);c.fillStyle=TH.accent;c.fillRect(Math.round(s.x-w/2),Math.round(s.y+3),2,17);
      c.fillStyle=TH.label;c.textAlign="center";c.textBaseline="middle";c.fillText(text,s.x,s.y+12)};
    labels.forEach(label);ownLabels.forEach(label);
    for(const t of labels.concat(ownLabels)){if(!t.elev||(t.hidden&&this.cfg.role!=="gm")||(playerView&&!mine(t)&&this.fogHides(m,t.x,t.y)))continue;
      const r=this.tokR(t),s=this.toScreen(t.x,t.y-r*1.02),text=`${t.elev>0?"↑":"↓"}${Math.abs(t.elev)} ${Grid.unit(g)}`;c.font=`600 11px ${TH.mono}`;const w=c.measureText(text).width+10;
      c.fillStyle="rgba(8,9,14,.9)";c.fillRect(Math.round(s.x-w/2),Math.round(s.y-19),Math.round(w),16);c.fillStyle="#eef0f6";c.textAlign="center";c.textBaseline="middle";c.fillText(text,s.x,s.y-10.5)}
    {const t=this.hover&&!this.drag?toks.find(x=>x.id===this.hover):null,text=t?Cond.describe(t):"";
      if(text){const r=this.tokR(t),s=this.toScreen(t.x+r*1.35,t.y-r*0.4);c.font=`12px ${TH.font}`;const w=Math.min(c.measureText(text).width,320)+14;
        c.fillStyle="rgba(8,9,14,.94)";c.fillRect(Math.round(s.x),Math.round(s.y-11),Math.round(w),22);c.fillStyle="#eef0f6";c.textAlign="left";c.textBaseline="middle";c.fillText(text,s.x+7,s.y,320)}}
    for(const {t,got} of tplInfo){const s=t.shape==="circle"?this.toScreen(t.x-10/z,t.y-t.size*Grid.size(g)):this.toScreen(t.x,t.y);if(s.x<-200||s.x>W+50||s.y<-20||s.y>H+60)continue;
      const text=Tpl.describe(t,g)+(got.length?` · ${got.length} caught`:"");
      c.font=`12px ${TH.mono}`;const w=c.measureText(text).width+14;c.fillStyle="rgba(8,9,14,.88)";c.fillRect(Math.round(s.x+10),Math.round(s.y-28),Math.round(w),20);
      c.fillStyle=t.color;c.fillRect(Math.round(s.x+10),Math.round(s.y-28),3,20);c.fillStyle="#eef0f6";c.textAlign="left";c.textBaseline="middle";c.fillText(text,s.x+17,s.y-18)}
    for(const r of rulers){const end=r.pts[r.pts.length-1];
      const s=this.toScreen(end.x,end.y);let ms=Grid.measure(g,r.pts);
      if(g.height!==false){const at=q=>toks.find(t=>(t.elev||0)!==undefined&&!(t.hidden&&this.cfg.role!=="gm")&&Math.hypot(t.x-q.x,t.y-q.y)<=this.tokR(t)),ta=at(r.pts[0]),tb=at(end);
        if(ta&&tb&&ta!==tb&&(ta.elev||0)!==(tb.elev||0))ms=Grid.lift(g,ms,(ta.elev||0)-(tb.elev||0))}
      const text=ms.text+(r.name?" · "+r.name:"");
      c.font=`13px ${TH.mono}`;const w=c.measureText(text).width+14;c.fillStyle="rgba(8,9,14,.88)";c.fillRect(Math.round(s.x+10),Math.round(s.y-26),Math.round(w),22);
      c.fillStyle=r.color;c.fillRect(Math.round(s.x+10),Math.round(s.y-26),3,22);c.fillStyle="#eef0f6";c.textAlign="left";c.textBaseline="middle";c.fillText(text,s.x+17,s.y-15)}
    if(this.preview&&this.cfg.role==="gm"){c.font=`12px ${TH.mono}`;c.fillStyle=TH.previewBg;c.fillRect(12,12,190,24);c.fillStyle=TH.previewInk;c.textAlign="left";c.textBaseline="middle";c.fillText("PREVIEWING PLAYER VIEW",20,24)}
    this.hud.textContent=`${Math.round(z*100)}%`;
    if(this.pings.length||Object.keys(this.remoteRulers).length&&rulers.length)this.invalidate();
  }
}

/* map image import: downscale big images and re-encode to keep transfers small */
async function prepareMapImage(file,maxSide=4096){
  const url=URL.createObjectURL(file);
  try{
    const im=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error("That file isn't an image this app can read."));i.src=url});
    let w=im.naturalWidth,h=im.naturalHeight;const sc=Math.min(1,maxSide/Math.max(w,h));w=Math.round(w*sc);h=Math.round(h*sc);
    const cv=document.createElement("canvas");cv.width=w;cv.height=h;const c=cv.getContext("2d");c.imageSmoothingQuality="high";c.drawImage(im,0,0,w,h);
    const blob=await new Promise(r=>cv.toBlob(r,"image/webp",0.86));
    return {blob,w,h,ext:"webp"};
  }finally{URL.revokeObjectURL(url)}
}
