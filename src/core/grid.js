/* ============================== MONOLITH CORE: GRID ==============================
   One place for every question about a map's grid: where things snap, how far apart two points
   are, which cell a point is in, and how the grid is drawn. The map, the ruler and (later) area
   templates and vision all ask here, so they always agree.

   A map's grid: {type, size, ox, oy, diag, m, unit, show, snap, color, alpha}
     type  "square" (default) | "hex-flat" | "hex-pointy" | "none"
     size  pixels from one cell's centre to the next: a square's side, a hex's flat side to flat side
     diag  how square grids count diagonals: "euclid" (straight line, default) | "one" (a diagonal
           costs one cell) | "alternate" (1, 2, 1, 2 ...)
     m     how many units one cell is worth, and unit its name ("m", "ft")
   A map saved before these existed is a square grid measured in a straight line, in metres.

   A game sets the defaults for its new maps by registering  map:{diag:"one", unit:{n:5, u:"ft"}}.

   Hex cells use axial coordinates {q, r}. Hex (0,0) sits in the grid's top-left corner. */
const Grid=(()=>{
  const TYPES=["square","hex-flat","hex-pointy","none"],DIAGS=["euclid","one","alternate"],R3=Math.sqrt(3);
  const type=g=>TYPES.includes(g&&g.type)?g.type:"square";
  const diag=g=>DIAGS.includes(g&&g.diag)?g.diag:"euclid";
  const size=g=>{const s=Number(g&&g.size);return s>0&&isFinite(s)?Math.max(4,Math.min(4000,s)):70};
  const ox=g=>Number(g&&g.ox)||0,oy=g=>Number(g&&g.oy)||0;
  const isHex=g=>type(g)!=="square"&&type(g)!=="none";
  const per=g=>{const n=Number(g&&g.m);return n>0&&isFinite(n)?n:2};
  const cleanUnit=u=>typeof u==="string"?u.replace(/[^A-Za-z0-9 .'"°′″À-ɏ]/g,"").trim().slice(0,8):"";
  const unit=g=>cleanUnit(g&&g.unit)||"m";
  /* does this grid count whole cells (hexes, or squares with a diagonal rule) rather than measure a straight line? */
  const counted=g=>isHex(g)||(type(g)==="square"&&diag(g)!=="euclid");

  /* ---- cells ---- */
  function hexRound(qf,rf){let x=qf,z=rf,y=-x-z,rx=Math.round(x),ry=Math.round(y),rz=Math.round(z);
    const dx=Math.abs(rx-x),dy=Math.abs(ry-y),dz=Math.abs(rz-z);
    if(dx>dy&&dx>dz)rx=-ry-rz;else if(dy<=dz)rz=-rx-ry;
    return {q:rx+0,r:rz+0}}
  /* the cell a point is in */
  function cell(g,x,y){const s=size(g),t=type(g);
    if(t==="hex-pointy"){const R=s/R3,rf=(y-oy(g)-R)/(1.5*R);return hexRound((x-ox(g)-s/2)/s-rf/2,rf)}
    if(t==="hex-flat"){const R=s/R3,qf=(x-ox(g)-R)/(1.5*R);return hexRound(qf,(y-oy(g)-s/2)/s-qf/2)}
    return {q:Math.floor((x-ox(g))/s),r:Math.floor((y-oy(g))/s)}}
  /* the middle of a cell */
  function center(g,c){const s=size(g),t=type(g);
    if(t==="hex-pointy"){const R=s/R3;return {x:ox(g)+s/2+s*(c.q+c.r/2),y:oy(g)+R+1.5*R*c.r}}
    if(t==="hex-flat"){const R=s/R3;return {x:ox(g)+R+1.5*R*c.q,y:oy(g)+s/2+s*(c.r+c.q/2)}}
    return {x:ox(g)+(c.q+.5)*s,y:oy(g)+(c.r+.5)*s}}
  /* a cell's corners, clockwise */
  function corners(g,c){const s=size(g),t=type(g),m=center(g,c);
    if(t==="hex-pointy"||t==="hex-flat"){const R=s/R3,a0=t==="hex-pointy"?-Math.PI/2:0,out=[];
      for(let i=0;i<6;i++){const a=a0+i*Math.PI/3;out.push({x:m.x+R*Math.cos(a),y:m.y+R*Math.sin(a)})}return out}
    const h=s/2;return [{x:m.x-h,y:m.y-h},{x:m.x+h,y:m.y-h},{x:m.x+h,y:m.y+h},{x:m.x-h,y:m.y+h}]}
  const hexSteps=(a,b)=>{const dq=a.q-b.q,dr=a.r-b.r;return (Math.abs(dq)+Math.abs(dr)+Math.abs(dq+dr))/2};

  /* ---- snapping ---- */
  /* where a token of this size (in cells) comes to rest: odd sizes on a cell's middle, even sizes on a corner */
  function snap(g,x,y,tokSize){const s=size(g),t=type(g),odd=(Math.round(Number(tokSize)||1)%2)===1;
    if(t==="none")return {x,y};
    if(t==="square"){if(odd)return center(g,cell(g,x,y));return {x:ox(g)+Math.round((x-ox(g))/s)*s,y:oy(g)+Math.round((y-oy(g))/s)*s}}
    const c=cell(g,x,y);if(odd)return center(g,c);
    let best=null,bd=Infinity;for(const p of corners(g,c)){const dd=(p.x-x)*(p.x-x)+(p.y-y)*(p.y-y);if(dd<bd){bd=dd;best=p}}return best}
  /* where a ruler's end sits: the middle of the cell on grids that count cells, the exact spot otherwise */
  const snapMeasure=(g,x,y)=>counted(g)&&(!g||g.snap!==false)?center(g,cell(g,x,y)):{x,y};
  const tokR=(g,tokSize)=>(Number(tokSize)||1)*size(g)/2;

  /* ---- distance ---- */
  /* a path of points [{x,y}, ...] -> {cells, dist, unit, counted, text} */
  function measure(g,pts){const s=size(g),t=type(g),whole=counted(g);let cells=0;
    if(!whole){for(let i=1;i<pts.length;i++)cells+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y)/s}
    else if(isHex(g)){for(let i=1;i<pts.length;i++)cells+=hexSteps(cell(g,pts[i-1].x,pts[i-1].y),cell(g,pts[i].x,pts[i].y))}
    else{let straight=0,diags=0; // diagonals are counted across the whole path, so 1-2-1-2 carries over a corner
      for(let i=1;i<pts.length;i++){const a=cell(g,pts[i-1].x,pts[i-1].y),b=cell(g,pts[i].x,pts[i].y),dx=Math.abs(a.q-b.q),dy=Math.abs(a.r-b.r);
        diags+=Math.min(dx,dy);straight+=Math.max(dx,dy)-Math.min(dx,dy)}
      cells=straight+diags+(diag(g)==="alternate"?Math.floor(diags/2):0)}
    const dist=cells*per(g),u=unit(g),num=v=>{const r=Math.round(v*10)/10;if(whole)return Math.abs(r-Math.round(r))<.05?String(Math.round(r)):r.toFixed(1);return r<10?r.toFixed(1):String(Math.round(r))};
    const noun=t==="none"?"":isHex(g)?"hex":"sq";
    const text=`${num(dist)} ${u}`+(noun?` · ${whole?cells:cells.toFixed(1)} ${noun}`:"");
    return {cells,dist,unit:u,counted:whole,text}}
  /* the same measurement between two things at different heights (dz in the map's units): the straight
     line on grids that measure one, and on counted grids a climb is paid like a diagonal */
  function lift(g,res,dz){const v=Math.abs(Number(dz)||0)/per(g);if(!(v>0))return res;let cells;
    if(!res.counted)cells=Math.hypot(res.cells,v);else if(isHex(g))cells=Math.round(Math.hypot(res.cells,v));
    else{const a=Math.max(res.cells,v),b=Math.min(res.cells,v);cells=Math.round(diag(g)==="alternate"?a+Math.floor(b/2):a)}
    const dist=cells*per(g),r=Math.round(dist*10)/10,n=res.counted?(Math.abs(r-Math.round(r))<.05?String(Math.round(r)):r.toFixed(1)):(r<10?r.toFixed(1):String(Math.round(r)));
    return {...res,cells,dist,text:`${n} ${res.unit} with height`}}

  /* ---- drawing ---- */
  /* adds the grid's lines inside a world rectangle to the current path; the caller strokes it */
  function path(c,g,x0,y0,x1,y1){const s=size(g),t=type(g);
    if(t==="none")return;
    if(t==="square"){const gx=((ox(g)%s)+s)%s,gy=((oy(g)%s)+s)%s;
      for(let x=gx+Math.floor((x0-gx)/s)*s;x<=x1;x+=s){if(x<x0-.01)continue;c.moveTo(x,y0);c.lineTo(x,y1)}
      for(let y=gy+Math.floor((y0-gy)/s)*s;y<=y1;y+=s){if(y<y0-.01)continue;c.moveTo(x0,y);c.lineTo(x1,y)}
      return}
    // hexes: each one draws half of its outline; its neighbours draw the rest
    const a=cell(g,x0,y0),b=cell(g,x1,y1),cc=cell(g,x1,y0),d=cell(g,x0,y1);
    const rMin=Math.min(a.r,b.r,cc.r,d.r)-1,rMax=Math.max(a.r,b.r,cc.r,d.r)+1,qMin=Math.min(a.q,b.q,cc.q,d.q)-1,qMax=Math.max(a.q,b.q,cc.q,d.q)+1;
    const R=s/R3,a0=t==="hex-pointy"?-Math.PI/2:0,off=[];for(let i=0;i<4;i++){const an=a0+i*Math.PI/3;off.push([R*Math.cos(an),R*Math.sin(an)])}
    for(let r=rMin;r<=rMax;r++)for(let q=qMin;q<=qMax;q++){const m=center(g,{q,r});
      if(m.x<x0-s||m.x>x1+s||m.y<y0-s||m.y>y1+s)continue;
      c.moveTo(m.x+off[0][0],m.y+off[0][1]);for(let i=1;i<4;i++)c.lineTo(m.x+off[i][0],m.y+off[i][1])}}

  /* ---- helpers for the GM's screens ---- */
  /* cell middles around a point, nearest first: used to find a free place for a new token */
  function around(g,x,y,rings){const s=size(g),out=[],hex=isHex(g);
    const c0=type(g)==="none"?null:cell(g,x,y),p0=c0?center(g,c0):{x,y};
    for(let r=0;r<=rings;r++)for(let dq=-r;dq<=r;dq++)for(let dr=-r;dr<=r;dr++){
      if(hex){if(hexSteps({q:dq,r:dr},{q:0,r:0})!==r)continue;out.push(center(g,{q:c0.q+dq,r:c0.r+dr}))}
      else{if(Math.max(Math.abs(dq),Math.abs(dr))!==r)continue;out.push({x:p0.x+dq*s,y:p0.y+dr*s})}}
    return out}
  /* "30×20 squares" */
  function describe(g,w,h){const s=size(g),t=type(g),R=s/R3;
    if(t==="none")return "No grid";
    if(t==="hex-pointy")return `${Math.max(1,Math.round(w/s))}×${Math.max(1,Math.round(h/(1.5*R)))} hexes`;
    if(t==="hex-flat")return `${Math.max(1,Math.round(w/(1.5*R)))}×${Math.max(1,Math.round(h/s))} hexes`;
    return `${Math.max(1,Math.round(w/s))}×${Math.max(1,Math.round(h/s))} squares`}
  /* a box dragged across n cells of the map picture -> the grid that matches it */
  function fitBox(g,x1,y1,x2,y2,n){n=Math.max(1,Math.round(Number(n)||1));const t=type(g),r2=v=>Math.round(v*100)/100;
    const w=Math.abs(x2-x1),h=Math.abs(y2-y1),l=Math.min(x1,x2),tp=Math.min(y1,y2);
    if(t==="hex-flat"){const s=Math.max(8,h/n);return {size:r2(s),ox:r2(l),oy:r2(tp)}}
    if(t==="hex-pointy"){const s=Math.max(8,w/n);return {size:r2(s),ox:r2(l),oy:r2(tp)}}
    const s=Math.max(8,(w+h)/2/n);return {size:r2(s),ox:r2(((l%s)+s)%s),oy:r2(((tp%s)+s)%s)}}
  /* what a game asks for on its new maps */
  function defaults(){const d=(typeof GAME!=="undefined"&&GAME&&GAME.map)||{},o={type:"square",diag:"euclid",m:2,unit:"m"};
    if(DIAGS.includes(d.diag))o.diag=d.diag;
    if(d.unit&&typeof d.unit==="object"){const n=Number(d.unit.n);if(n>0&&isFinite(n))o.m=n;const u=cleanUnit(d.unit.u);if(u)o.unit=u}
    return o}
  return {TYPES,DIAGS,type,diag,size,isHex,per,unit,cleanUnit,counted,cell,center,corners,hexSteps,snap,snapMeasure,tokR,measure,lift,path,around,describe,fitBox,defaults};
})();
/* kept for games that call it */
function snapPoint(grid,x,y,size){return Grid.snap(grid,x,y,size)}
