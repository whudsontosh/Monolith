
/* ============================== MONOLITH CORE: MAP ENGINE ============================== */
/* A canvas battle map in the spirit of Owlbear Rodeo: image + grid, tokens, fog, drawings, ruler, pings.
   World units are map-image pixels. The view never owns game state: it reads cfg.getMap() and reports
   what the user did through cfg.onEvent(type, data); the GM applies it, players send it to the GM. */
/* map look: games can restyle it with Monolith.theme.map */
function mapTheme(){const t=Monolith.theme.map||{};return {void:t.void||"#030303",corner:t.corner||"rgba(255,255,255,.7)",activeGlow:t.activeGlow||"rgba(255,255,255,.18)",font:t.font||'"Inter Tight","Segoe UI",sans-serif',
  mono:t.mono||'"JetBrains Mono",ui-monospace,monospace',select:t.select||"#ffffff",accent:t.accent||"#ffffff",label:t.label||"#f4f4f2",labelBg:t.labelBg||"rgba(3,3,3,.84)",previewBg:t.previewBg||"rgba(255,255,255,.92)",previewInk:t.previewInk||"#050505"}}
const INK_COLORS=["#ff4459","#f2a93b","#ffe14d","#4cc98c","#38d6f0","#7d95ff","#c77dff","#ffffff"];
const TOKEN_COLORS=["#c8102e","#2346d1","#18744a","#a76200","#6c2bd9","#0e7c86","#b3127a","#3d4352","#111318","#d9dbe3"];
function snapPoint(grid,x,y,size){const s=Math.max(4,Number(grid.size)||70),ox=Number(grid.ox)||0,oy=Number(grid.oy)||0;
  if((size||1)%2===1)return {x:ox+(Math.floor((x-ox)/s)+0.5)*s,y:oy+(Math.floor((y-oy)/s)+0.5)*s};
  return {x:ox+Math.round((x-ox)/s)*s,y:oy+Math.round((y-oy)/s)*s}}
function newMapData(o){return {id:uid(),name:o.name||"New map",asset:o.asset||null,w:o.w||2100,h:o.h||1400,bg:o.bg||"#1d2029",
  grid:{size:o.size||70,ox:0,oy:0,show:true,snap:true,color:"#ffffff",alpha:0.22,m:2},tokens:[],drawings:[],fog:{on:true,shapes:[]},created:Date.now()}}
function segDist(px,py,ax,ay,bx,by){const dx=bx-ax,dy=by-ay;const l=dx*dx+dy*dy;let t=l?((px-ax)*dx+(py-ay)*dy)/l:0;t=Math.max(0,Math.min(1,t));const x=ax+t*dx,y=ay+t*dy;return Math.hypot(px-x,py-y)}
function inPoly(x,y,p){let c=false;for(let i=0,j=p.length-2;i<p.length;j=i,i+=2){const xi=p[i],yi=p[i+1],xj=p[j],yj=p[j+1];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))c=!c}return c}

class MapView{
  constructor(cfg){
    this.cfg=cfg; // {role:'gm'|'player', getMap(), canMove(tok), canErase(d), onEvent(type,data), imgUrl(asset), me(){return {color,name}}, ringFor(tok), activeTok()}
    this.el=document.createElement("div");this.el.className="mapview";this.el.tabIndex=0;
    this.canvas=document.createElement("canvas");this.el.appendChild(this.canvas);
    this.hud=document.createElement("div");this.hud.className="map-hud";this.el.appendChild(this.hud);
    this.ctx=this.canvas.getContext("2d");
    this.cam={x:0,y:0,z:1};this.cams={};this.mapId=null;
    this.tool="select";this.drawMode="pen";this.inkColor=INK_COLORS[0];this.inkWidth=4;
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
  setTool(t){this.tool=t;this.poly=null;this.cur=null;this.canvas.style.cursor=t==="pan"?"grab":t==="select"?"default":"crosshair";this.invalidate()}
  tokR(t){const g=this.map.grid;return (Number(t.size)||1)*(Number(g.size)||70)/2}
  visibleTokens(){const m=this.map;return (m.tokens||[])}
  hitToken(w){const ts=this.visibleTokens();for(let i=ts.length-1;i>=0;i--){const t=ts[i];if(this.cfg.role!=="gm"&&t.hidden)continue;if(Math.hypot(w.x-t.x,w.y-t.y)<=this.tokR(t))return t}return null}
  hitDrawing(w){const m=this.map;const tol=8/this.cam.z;const ds=m.drawings||[];
    for(let i=ds.length-1;i>=0;i--){const d=ds[i];const p=d.pts;if(d.type==="rect"&&p.length>=4){const [x1,y1,x2,y2]=p;const xs=[x1,x2].sort((a,b)=>a-b),ys=[y1,y2].sort((a,b)=>a-b);
        if(w.x>xs[0]-tol&&w.x<xs[1]+tol&&w.y>ys[0]-tol&&w.y<ys[1]+tol&&!(w.x>xs[0]+tol&&w.x<xs[1]-tol&&w.y>ys[0]+tol&&w.y<ys[1]-tol))return d;continue}
      for(let j=0;j+3<p.length;j+=2)if(segDist(w.x,w.y,p[j],p[j+1],p[j+2],p[j+3])<tol+(d.w||2)/2)return d}
    return null}
  addPing(x,y,color){this.pings.push({x,y,color:color||"#ff4459",t:performance.now()});this.invalidate()}
  setRemoteRuler(by,data){if(!data)delete this.remoteRulers[by];else this.remoteRulers[by]={...data,t:performance.now()};this.invalidate()}

  /* ---------------- input ---------------- */
  down(e){
    const m=this.map;if(!m)return;this.el.focus({preventScroll:true});
    try{this.canvas.setPointerCapture(e.pointerId)}catch(_){}
    const p=this.pt(e),w=this.toWorld(p.x,p.y);
    if(e.button===1||e.button===2||this.space||this.tool==="pan"){this.drag={k:"pan",sx:p.x,sy:p.y,cx:this.cam.x,cy:this.cam.y};this.canvas.style.cursor="grabbing";return}
    if(e.button!==0)return;
    if(e.altKey||this.tool==="ping"){this.addPing(w.x,w.y,this.cfg.me().color);this.emit("ping",{x:w.x,y:w.y});return}
    const t=this.tool;
    if(t==="select"){const tok=this.hitToken(w);
      if(tok){this.sel=tok.id;this.emit("select",tok.id);
        if(this.cfg.canMove(tok))this.drag={k:"tok",id:tok.id,dx:w.x-tok.x,dy:w.y-tok.y,ox:tok.x,oy:tok.y,moved:false};
        this.invalidate();return}
      if(this.sel){this.sel=null;this.emit("select",null)}
      this.drag={k:"pan",sx:p.x,sy:p.y,cx:this.cam.x,cy:this.cam.y};this.canvas.style.cursor="grabbing";this.invalidate();return}
    if(t==="ruler"){this.ruler={a:w,b:w};this.drag={k:"ruler"};this.emitRuler(true);this.invalidate();return}
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
      if(this.tool==="select"&&m){const tok=this.hitToken(w);const id=tok?tok.id:null;if(id!==this.hover){this.hover=id;this.canvas.style.cursor=tok&&this.cfg.canMove(tok)?"grab":"default";this.invalidate()}}
      return}
    if(d.k==="pan"){this.cam.x=d.cx-(p.x-d.sx)/this.cam.z;this.cam.y=d.cy-(p.y-d.sy)/this.cam.z;this.invalidate();return}
    if(d.k==="tok"){const tok=(m.tokens||[]).find(x=>x.id===d.id);if(!tok){this.drag=null;return}
      tok.x=clamp(w.x-d.dx,0,m.w);tok.y=clamp(w.y-d.dy,0,m.h);d.moved=true;this.canvas.style.cursor="grabbing";
      const now=performance.now();if(now-this.lastEmit>45){this.lastEmit=now;this.emit("move",{id:tok.id,x:tok.x,y:tok.y,final:false})}
      this.invalidate();return}
    if(d.k==="ruler"){this.ruler.b=w;this.emitRuler(false);this.invalidate();return}
    if(d.k==="erase"){const dr=this.hitDrawing(w);if(dr&&this.cfg.canErase(dr))this.emit("draw-del",{id:dr.id});return}
    if(d.k==="draw"&&this.cur){const pts=this.cur.pts;
      if(this.cur.type==="pen"){const lx=pts[pts.length-2],ly=pts[pts.length-1];if(Math.hypot(w.x-lx,w.y-ly)*this.cam.z>=2.5&&pts.length<4000)pts.push(+w.x.toFixed(1),+w.y.toFixed(1))}
      else{pts[2]=w.x;pts[3]=w.y}
      this.invalidate();return}
    if(d.k==="fogrect"){d.b=w;this.invalidate();return}
  }
  up(e){
    const d=this.drag;this.drag=null;const m=this.map;
    if(this.tool==="pan")this.canvas.style.cursor="grab";else if(this.tool==="select")this.canvas.style.cursor="default";
    if(!d||!m)return;
    if(d.k==="pan"){this.saveCam();return}
    if(d.k==="tok"){const tok=(m.tokens||[]).find(x=>x.id===d.id);if(!tok)return;
      if(!d.moved){this.invalidate();return}
      if(m.grid.snap!==false){const s=snapPoint(m.grid,tok.x,tok.y,tok.size);tok.x=clamp(s.x,0,m.w);tok.y=clamp(s.y,0,m.h)}
      this.emit("move",{id:tok.id,x:Math.round(tok.x),y:Math.round(tok.y),final:true});this.invalidate();return}
    if(d.k==="ruler"){const r=this.ruler;clearTimeout(this.rulerT);this.rulerT=setTimeout(()=>{this.ruler=null;this.emit("ruler",null);this.invalidate()},1600);return}
    if(d.k==="draw"&&this.cur){const c=this.cur;this.cur=null;const p=c.pts;
      const len=p.length>=4?Math.hypot(p[p.length-2]-p[0],p[p.length-1]-p[1]):0;
      if(c.type==="pen"?p.length>=4:len*this.cam.z>3){c.pts=p.map(v=>+(+v).toFixed(1));this.emit("draw-add",c)}
      this.invalidate();return}
    if(d.k==="fogrect"){const x1=Math.min(d.a.x,d.b.x),y1=Math.min(d.a.y,d.b.y),x2=Math.max(d.a.x,d.b.x),y2=Math.max(d.a.y,d.b.y);
      if((x2-x1)*this.cam.z>4&&(y2-y1)*this.cam.z>4)this.emit("fog-add",{id:uid(),op:d.op,type:"rect",pts:[x1,y1,x2,y2].map(v=>Math.round(v))});
      this.invalidate();return}
  }
  finishPoly(){const p=this.poly;this.poly=null;if(p&&p.pts.length>=6)this.emit("fog-add",{id:uid(),op:p.op,type:"poly",pts:p.pts.map(v=>Math.round(v))});this.invalidate()}
  dbl(e){const m=this.map;if(!m)return;const p=this.pt(e),w=this.toWorld(p.x,p.y);
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
    if(k==="escape"){if(this.poly){this.poly=null;this.invalidate()}else if(this.sel){this.sel=null;this.emit("select",null);this.invalidate()}return}
    if(k==="enter"&&this.poly){this.finishPoly();return}
    if((k==="delete"||k==="backspace")&&this.sel){this.emit("token-del",this.sel);return}
    if(k==="+"||k==="="){this.zoomBy(1.2);return}
    if(k==="-"||k==="_"){this.zoomBy(1/1.2);return}
    if(k==="0"){this.fit();return}
    const map={v:"select",h:"pan",r:"ruler",d:"draw",p:"ping"};if(this.cfg.role==="gm"){map.f="fog-rect"}
    if(map[k]&&!e.ctrlKey&&!e.metaKey){this.emit("tool",map[k])}
  }
  emitRuler(force){const now=performance.now();if(!force&&now-this.lastRuler<60)return;this.lastRuler=now;const r=this.ruler;if(!r)return;
    this.emit("ruler",{a:[Math.round(r.a.x),Math.round(r.a.y)],b:[Math.round(r.b.x),Math.round(r.b.y)]})}

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
    const g=m.grid||{};if(g.show!==false){const s=Math.max(4,Number(g.size)||70),ox=((Number(g.ox)||0)%s+s)%s,oy=((Number(g.oy)||0)%s+s)%s;
      const v0=this.toWorld(0,0),v1=this.toWorld(W,H);const x0=Math.max(0,v0.x),x1=Math.min(m.w,v1.x),y0=Math.max(0,v0.y),y1=Math.min(m.h,v1.y);
      if(s*z>=5&&x1>x0&&y1>y0){c.beginPath();for(let x=ox+Math.floor((x0-ox)/s)*s;x<=x1;x+=s){if(x<0)continue;c.moveTo(x,y0);c.lineTo(x,y1)}
        for(let y=oy+Math.floor((y0-oy)/s)*s;y<=y1;y+=s){if(y<0)continue;c.moveTo(x0,y);c.lineTo(x1,y)}
        c.strokeStyle=g.color||"#fff";c.globalAlpha=clamp(Number(g.alpha??0.22),0.03,1);c.lineWidth=1/z;c.stroke();c.globalAlpha=1}}
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
    const labels=[];
    const drawTok=(t)=>{const r=this.tokR(t);const hidden=t.hidden;if(hidden&&this.cfg.role!=="gm")return;
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
      if(t.id===this.sel||t.id===this.hover){c.setLineDash([6/z,4/z]);c.lineWidth=2/z;c.strokeStyle=t.id===this.sel?TH.select:"rgba(255,255,255,.6)";c.beginPath();c.arc(t.x,t.y,r*1.18,0,Math.PI*2);c.stroke();c.setLineDash([])}
      if(hidden&&this.cfg.role==="gm"){c.globalAlpha=1;c.fillStyle="#0b0c11";c.font=`${Math.max(9/z,r*0.3)}px ${TH.mono}`;c.textAlign="center";c.fillText("HIDDEN",t.x,t.y-r*1.3)}
      c.restore();
      labels.push(t)};
    const mine=t=>t.owner&&t.owner===me.playerId;
    const toks=m.tokens||[];
    toks.filter(t=>!(playerView&&mine(t))).forEach(drawTok);
    // fog
    if(m.fog&&m.fog.on&&(m.fog.shapes||[]).length){const fc=this.fogLayer(m);c.save();c.globalAlpha=playerView?1:0.55;c.imageSmoothingEnabled=true;c.drawImage(fc,0,0,m.w,m.h);c.restore()}
    const ownLabels=[];
    if(playerView){const before=labels.length;toks.filter(mine).forEach(drawTok);ownLabels.push(...labels.splice(before))}
    // fog editing previews
    if(this.drag&&this.drag.k==="fogrect"){const d=this.drag;c.save();c.fillStyle=d.op==="cut"?"rgba(76,201,140,.25)":"rgba(0,0,0,.45)";c.strokeStyle=d.op==="cut"?"#4cc98c":"#ff4459";c.lineWidth=2/z;c.setLineDash([8/z,5/z]);
      c.fillRect(d.a.x,d.a.y,d.b.x-d.a.x,d.b.y-d.a.y);c.strokeRect(d.a.x,d.a.y,d.b.x-d.a.x,d.b.y-d.a.y);c.restore()}
    if(this.poly){const p=this.poly.pts;c.save();c.strokeStyle=this.poly.op==="cut"?"#4cc98c":"#ff4459";c.lineWidth=2/z;c.setLineDash([8/z,5/z]);c.beginPath();c.moveTo(p[0],p[1]);for(let i=2;i<p.length;i+=2)c.lineTo(p[i],p[i+1]);
      if(this.mouse)c.lineTo(this.mouse.x,this.mouse.y);c.stroke();c.setLineDash([]);c.fillStyle=c.strokeStyle;for(let i=0;i<p.length;i+=2){c.beginPath();c.arc(p[i],p[i+1],(i===0?6:3.5)/z,0,Math.PI*2);c.fill()}c.restore()}
    // pings
    this.pings=this.pings.filter(pg=>now-pg.t<2200);
    for(const pg of this.pings){const a=(now-pg.t)/2200;c.save();c.strokeStyle=pg.color;for(let k=0;k<2;k++){const aa=(a+k*0.35)%1;c.globalAlpha=1-aa;c.lineWidth=3/z;c.beginPath();c.arc(pg.x,pg.y,(10+aa*60)/z,0,Math.PI*2);c.stroke()}
      c.globalAlpha=1;c.fillStyle=pg.color;c.beginPath();c.arc(pg.x,pg.y,5/z,0,Math.PI*2);c.fill();c.restore()}
    // rulers (world lines)
    const rulers=[];if(this.ruler)rulers.push({a:this.ruler.a,b:this.ruler.b,color:me.color||"#38d6f0",name:""});
    for(const k in this.remoteRulers){const r=this.remoteRulers[k];if(now-r.t>8000){delete this.remoteRulers[k];continue}rulers.push({a:{x:r.a[0],y:r.a[1]},b:{x:r.b[0],y:r.b[1]},color:r.color||"#f2a93b",name:r.name||""})}
    for(const r of rulers){c.save();c.strokeStyle=r.color;c.lineWidth=3/z;c.setLineDash([10/z,6/z]);c.beginPath();c.moveTo(r.a.x,r.a.y);c.lineTo(r.b.x,r.b.y);c.stroke();c.setLineDash([]);c.fillStyle=r.color;
      [r.a,r.b].forEach(q=>{c.beginPath();c.arc(q.x,q.y,5/z,0,Math.PI*2);c.fill()});c.restore()}
    // screen-space overlays: labels + ruler readouts
    c.setTransform(dpr,0,0,dpr,0,0);
    const label=(t)=>{if(t.hidden&&this.cfg.role!=="gm")return;if(playerView&&!mine(t)&&this.fogHides(m,t.x,t.y))return;const r=this.tokR(t);const s=this.toScreen(t.x,t.y+r*1.02);
      if(s.x<-80||s.x>W+80||s.y<-40||s.y>H+40)return;const text=String(t.label||"");if(!text)return;
      c.font=`700 13px ${TH.font}`;const w=c.measureText(text).width+10;c.fillStyle=TH.labelBg;c.fillRect(Math.round(s.x-w/2),Math.round(s.y+3),Math.round(w),17);c.fillStyle=TH.accent;c.fillRect(Math.round(s.x-w/2),Math.round(s.y+3),2,17);
      c.fillStyle=TH.label;c.textAlign="center";c.textBaseline="middle";c.fillText(text,s.x,s.y+12)};
    labels.forEach(label);ownLabels.forEach(label);
    for(const r of rulers){const cells=Math.hypot(r.b.x-r.a.x,r.b.y-r.a.y)/Math.max(4,Number(g.size)||70);const meters=cells*(Number(g.m)||2);
      const s=this.toScreen(r.b.x,r.b.y);const text=`${meters.toFixed(meters<10?1:0)} m · ${cells.toFixed(1)} sq${r.name?" · "+r.name:""}`;
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
