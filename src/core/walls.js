/* ============================== MONOLITH CORE: WALLS AND DOORS ==============================
   Lines the GM draws on a map (1.5). A wall lives in map.walls:
     {id, a:[x,y], b:[x,y], kind, open, locked}        positions in map pixels
   kind decides what it stops:
     wall       movement and sight          window     movement only
     door       both while closed           invisible  movement only (a cliff edge, a force field)
     curtain    sight only (smoke, a hedge)
   Sight is used from 1.6 (lighting and vision); movement is used now.

   Players never receive walls. They get doors only (where they are, and open or closed), so
   they can click them. A player's move is checked on the GM's side, where the walls are. */
const Walls=(()=>{
  const KINDS=["wall","door","window","invisible","curtain"];
  const LOOK={wall:{color:"#ffd94a",name:"Wall"},door:{color:"#ff7a3c",name:"Door"},window:{color:"#38d6f0",name:"Window"},invisible:{color:"#a1a4b8",name:"Invisible wall",dash:true},curtain:{color:"#c77dff",name:"Curtain",dash:true}};
  const blocksMove=w=>w.kind==="door"?!w.open:w.kind!=="curtain";
  const blocksSight=w=>w.kind==="door"?!w.open:(w.kind==="wall"||w.kind==="curtain");
  const pt=(p,W,H)=>{const x=Number(p&&p[0]),y=Number(p&&p[1]);return isFinite(x)&&isFinite(y)?[Math.round(Math.max(-W,Math.min(2*W,x))*10)/10,Math.round(Math.max(-H,Math.min(2*H,y))*10)/10]:null};
  /* anything from a file or an event becomes a well-formed wall, or null */
  function clean(d,m){if(!d||typeof d!=="object")return null;const W=(m&&m.w)||4000,H=(m&&m.h)||4000,a=pt(d.a,W,H),b=pt(d.b,W,H);
    if(!a||!b||Math.hypot(a[0]-b[0],a[1]-b[1])<2)return null;
    const w={id:String(d.id||"").replace(/[^A-Za-z0-9_-]/g,"").slice(0,40)||uid(),a,b,kind:KINDS.includes(d.kind)?d.kind:"wall"};
    if(w.kind==="door"){if(d.open)w.open=true;if(d.locked)w.locked=true}return w}
  /* where segment p->q crosses segment a->b: how far along p->q (0..1), or null */
  function cross(px,py,qx,qy,ax,ay,bx,by){const rx=qx-px,ry=qy-py,sx=bx-ax,sy=by-ay,den=rx*sy-ry*sx;if(Math.abs(den)<1e-9)return null;
    const t=((ax-px)*sy-(ay-py)*sx)/den,u=((ax-px)*ry-(ay-py)*rx)/den;return t>=0&&t<=1&&u>=-1e-6&&u<=1+1e-6?t:null}
  /* the first wall a straight move from p to q runs into: {t, wall} or null. Leaving a wall you stand on is
     allowed; coming to rest exactly on one is not, so nothing can straddle a wall and step off the far side. */
  function firstHit(walls,p,q,test){let best=null;const len=Math.hypot(q.x-p.x,q.y-p.y);if(len<1e-6)return null;const e0=0.75/len;
    for(const w of walls||[]){if(!test(w))continue;const t=cross(p.x,p.y,q.x,q.y,w.a[0],w.a[1],w.b[0],w.b[1]);if(t===null||t<e0)continue;if(!best||t<best.t)best={t,wall:w}}
    return best}
  const blocked=(m,p,q)=>!!firstHit(m&&m.walls,p,q,blocksMove);
  /* where a token ends up when it is moved from `from` toward `to`: at `to` if nothing is in the way,
     otherwise the last place before the wall that it can rest (snapped to the grid when the map snaps) */
  function stop(m,from,to,tok){const hit=firstHit(m&&m.walls,from,to,blocksMove);if(!hit)return {x:to.x,y:to.y,hit:null};
    const g=m.grid,len=Math.hypot(to.x-from.x,to.y-from.y),back=Math.min(hit.t*len,Math.max(6,Grid.tokR(g,tok&&tok.size)*.6));
    for(const d of [back,back+Grid.size(g)*.5,back+Grid.size(g)]){const t=Math.max(0,hit.t-d/len);let p={x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t};
      if(g.snap!==false)p=Grid.snap(g,p.x,p.y,tok&&tok.size);if(!blocked(m,from,p))return {x:p.x,y:p.y,hit:hit.wall}}
    return {x:from.x,y:from.y,hit:hit.wall}}
  /* where a wall's end goes: the end of another wall close by, else the nearest grid corner or cell middle */
  function snapEnd(m,x,y,z,skip){const tol=11/(z||1);let best=null,bd=tol;
    for(const w of m.walls||[]){if(skip&&skip.has(w.id))continue;for(const p of [w.a,w.b]){const d=Math.hypot(p[0]-x,p[1]-y);if(d<bd){bd=d;best={x:p[0],y:p[1]}}}}
    if(best)return best;const g=m.grid;if(g.snap===false||Grid.type(g)==="none")return {x,y};
    const c=Grid.cell(g,x,y);best=Grid.center(g,c);bd=Math.hypot(best.x-x,best.y-y);for(const p of Grid.corners(g,c)){const d=Math.hypot(p.x-x,p.y-y);if(d<bd){bd=d;best=p}}return best}
  const mid=w=>({x:(w.a[0]+w.b[0])/2,y:(w.a[1]+w.b[1])/2});
  /* what players are told: doors only, never whether one is locked */
  const doorsFor=m=>(m.walls||[]).filter(w=>w.kind==="door").map(w=>({id:w.id,a:w.a,b:w.b,open:!!w.open}));
  /* a Universal VTT file (.dd2vtt, .uvtt, .df2vtt) -> {ppg, cols, rows, walls, lights, image} with positions in
     the file's own pixels. Throws a readable error when the file isn't one. */
  function fromUvtt(text){let j;try{j=JSON.parse(text)}catch(e){throw new Error("That file isn't a Universal VTT map.")}
    const res=j&&j.resolution,ppg=Number(res&&res.pixels_per_grid),cols=Number(res&&res.map_size&&res.map_size.x),rows=Number(res&&res.map_size&&res.map_size.y);
    if(!(ppg>0)||!(cols>0)||!(rows>0)||typeof j.image!=="string")throw new Error("That file isn't a Universal VTT map.");
    const ox=Number(res.map_origin&&res.map_origin.x)||0,oy=Number(res.map_origin&&res.map_origin.y)||0,P=p=>[(Number(p.x)-ox)*ppg,(Number(p.y)-oy)*ppg],walls=[],ok=p=>p&&isFinite(Number(p.x))&&isFinite(Number(p.y));
    for(const key of ["line_of_sight","objects_line_of_sight"])for(const line of Array.isArray(j[key])?j[key]:[]){if(!Array.isArray(line))continue;
      for(let i=1;i<line.length&&walls.length<6000;i++)if(ok(line[i-1])&&ok(line[i]))walls.push({a:P(line[i-1]),b:P(line[i]),kind:"wall"})}
    for(const d of Array.isArray(j.portals)?j.portals:[]){const b=d&&d.bounds;if(Array.isArray(b)&&b.length>=2&&ok(b[0])&&ok(b[1])&&walls.length<6000)walls.push({a:P(b[0]),b:P(b[1]),kind:"door",open:d.closed===false})}
    const lights=[];for(const l of Array.isArray(j.lights)?j.lights.slice(0,300):[]){if(!l||!ok(l.position))continue;const p=P(l.position),c=String(l.color||"").replace(/^#?/,"");
      lights.push({x:p[0],y:p[1],r:Math.max(0,Number(l.range)||0),color:/^[0-9a-fA-F]{6,8}$/.test(c)?"#"+c.slice(-6):"#ffd94a"})}
    return {ppg,cols,rows,walls,lights,image:j.image}}
  return {KINDS,LOOK,blocksMove,blocksSight,clean,cross,firstHit,blocked,stop,snapEnd,mid,doorsFor,fromUvtt};
})();
