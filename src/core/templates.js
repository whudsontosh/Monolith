/* ============================== MONOLITH CORE: AREA TEMPLATES ==============================
   Shapes laid on the map to show what an effect covers: a circle (blast), a cone, a line and a
   square. A template lives in map.templates:
     {id, shape, x, y, size, width, angle, color, label, by, fixed}
   x,y is where it starts (a circle's middle, a cone's point, a line's start, a square's top-left
   corner) in map pixels. size and width are in CELLS, so "20 ft" stays 20 ft if the GM rescales
   the grid. angle is in radians. by is who placed it ("gm" or a player id). fixed marks one that
   came from a game's preset: it can be moved and turned, not resized.

   The core only does geometry. A game gives it meaning by registering, all optional:
     map:{
       templates:[{id:"fireball", name:"Fireball", shape:"circle", size:20, color:"#f2a93b"}],
                              // ready-made templates; size and width are in the map's units (ft, m)
       inside:"centre",       // who is caught: "centre" (a token's middle is inside, the default),
                              // "touch" (any part of the token) or "cells" (the token stands on a
                              // cell at least half covered)
       origin:"any",          // where a template may start: "corner", "centre" or "any" (either)
       cone:53.13,            // a cone's full angle in degrees (the default is as wide as it is long)
       onCaught(tpl, tokens){}// GM side: called when a template is placed or changed
     } */
const Tpl=(()=>{
  const SHAPES=["circle","cone","line","square"],RULES=["centre","touch","cells"],TAU=Math.PI*2;
  const gm=()=>(typeof GAME!=="undefined"&&GAME&&GAME.map)||{};
  const rule=()=>RULES.includes(gm().inside)?gm().inside:"centre";
  const coneHalf=()=>{const d=Number(gm().cone);return (d>=10&&d<=180?d:53.13)*Math.PI/360};
  const num=(v,lo,hi,dflt)=>{v=Number(v);return isFinite(v)?Math.max(lo,Math.min(hi,v)):dflt};
  /* anything from the network or a game becomes a well-formed template, or null */
  function clean(d,m){if(!d||typeof d!=="object"||!SHAPES.includes(d.shape))return null;const W=(m&&m.w)||4000,H=(m&&m.h)||4000;
    const t={id:String(d.id||"").replace(/[^A-Za-z0-9_-]/g,"").slice(0,40)||uid(),shape:d.shape,x:Math.round(num(d.x,-W,2*W,0)),y:Math.round(num(d.y,-H,2*H,0)),
      size:Math.round(num(d.size,.25,400,1)*100)/100,width:Math.round(num(d.width,.25,100,1)*100)/100,angle:Math.round((((num(d.angle,-1e3,1e3,0)%TAU)+TAU)%TAU)*1e4)/1e4,
      color:/^#[0-9a-fA-F]{6}$/.test(d.color||"")?d.color:"#f2a93b",label:cleanText(d.label||"",40)};
    if(d.fixed)t.fixed=true;return t}
  /* a game's presets, sized in cells for this map */
  function presets(g){const per=Grid.per(g),out=[];
    for(const p of Array.isArray(gm().templates)?gm().templates.slice(0,60):[]){if(!p||!SHAPES.includes(p.shape))continue;
      out.push({id:String(p.id||p.name||"").slice(0,40),name:cleanText(p.name||p.id||"Template",40),shape:p.shape,size:num(p.size,.01,1e5,per)/per,width:num(p.width,.01,1e5,per)/per,color:/^#[0-9a-fA-F]{6}$/.test(p.color||"")?p.color:null})}
    return out}
  /* where a template may start, near a point */
  function snapOrigin(g,x,y){if(!g||g.snap===false||Grid.type(g)==="none")return {x,y};
    const o=["corner","centre","any"].includes(gm().origin)?gm().origin:"any",c=Grid.cell(g,x,y),mid=Grid.center(g,c);if(o==="centre")return mid;
    let best=o==="any"?mid:null,bd=best?Math.hypot(mid.x-x,mid.y-y):Infinity;
    for(const p of Grid.corners(g,c)){const dd=Math.hypot(p.x-x,p.y-y);if(dd<bd){bd=dd;best=p}}return best}

  /* ---- geometry, in map pixels ---- */
  const len=(t,g)=>t.size*Grid.size(g);
  /* the outline as points [{x,y}, ...]; a circle is returned as 40 points */
  function outline(t,g){const L=len(t,g),p=[];
    if(t.shape==="circle"){for(let i=0;i<40;i++)p.push({x:t.x+L*Math.cos(i*TAU/40),y:t.y+L*Math.sin(i*TAU/40)});return p}
    if(t.shape==="cone"){const h=coneHalf(),n=Math.max(4,Math.ceil(h*2/0.14));p.push({x:t.x,y:t.y});for(let i=0;i<=n;i++){const a=t.angle-h+i*2*h/n;p.push({x:t.x+L*Math.cos(a),y:t.y+L*Math.sin(a)})}return p}
    if(t.shape==="line"){const w=t.width*Grid.size(g)/2,c=Math.cos(t.angle),s=Math.sin(t.angle);
      return [{x:t.x+s*w,y:t.y-c*w},{x:t.x+c*L+s*w,y:t.y+s*L-c*w},{x:t.x+c*L-s*w,y:t.y+s*L+c*w},{x:t.x-s*w,y:t.y+c*w}]}
    return [{x:t.x,y:t.y},{x:t.x+L,y:t.y},{x:t.x+L,y:t.y+L},{x:t.x,y:t.y+L}]}
  /* the far end: where the handle for turning and resizing sits */
  function endPoint(t,g){const L=len(t,g);if(t.shape==="square")return {x:t.x+L,y:t.y+L};
    const a=t.shape==="circle"?0:t.angle;return {x:t.x+L*Math.cos(a),y:t.y+L*Math.sin(a)}}
  function contains(t,g,px,py){const L=len(t,g),e=.5,dx=px-t.x,dy=py-t.y;
    if(t.shape==="circle")return Math.hypot(dx,dy)<=L+e;
    if(t.shape==="cone"){const d=Math.hypot(dx,dy);if(d<=e)return true;if(d>L+e)return false;let a=Math.atan2(dy,dx)-t.angle;a=Math.atan2(Math.sin(a),Math.cos(a));return Math.abs(a)<=coneHalf()+e/d}
    if(t.shape==="line"){const c=Math.cos(t.angle),s=Math.sin(t.angle),al=dx*c+dy*s,pr=-dx*s+dy*c;return al>=-e&&al<=L+e&&Math.abs(pr)<=t.width*Grid.size(g)/2+e}
    return dx>=-e&&dx<=L+e&&dy>=-e&&dy<=L+e}
  /* how far a point is from the shape (0 inside) */
  function distance(t,g,px,py){if(contains(t,g,px,py))return 0;if(t.shape==="circle")return Math.hypot(px-t.x,py-t.y)-len(t,g);
    const o=outline(t,g);let best=Infinity;for(let i=0;i<o.length;i++){const a=o[i],b=o[(i+1)%o.length];best=Math.min(best,segDist(px,py,a.x,a.y,b.x,b.y))}return best}

  /* ---- cells and tokens ---- */
  /* points spread evenly over a cell, to estimate how much of it a shape covers */
  function samples(g,c){const out=[];
    if(Grid.isHex(g)){const m=Grid.center(g,c),k=Grid.corners(g,c);out.push(m);
      for(let i=0;i<6;i++){const a=k[i],b=k[(i+1)%6];out.push({x:m.x+(a.x-m.x)*.55,y:m.y+(a.y-m.y)*.55},{x:m.x+((a.x+b.x)/2-m.x)*.8,y:m.y+((a.y+b.y)/2-m.y)*.8})}return out}
    const s=Grid.size(g),k=Grid.corners(g,c)[0];for(let i=0;i<4;i++)for(let j=0;j<4;j++)out.push({x:k.x+(i+.5)*s/4,y:k.y+(j+.5)*s/4});return out}
  const cellCache=new Map();
  /* the cells a shape covers at least half of: [{q,r}, ...] */
  function cells(t,g){if(Grid.type(g)==="none")return [];
    const key=[t.shape,t.x,t.y,t.size,t.width,t.angle,Grid.type(g),Grid.size(g),g.ox||0,g.oy||0,coneHalf()].join("|");if(cellCache.has(key))return cellCache.get(key);
    const o=outline(t,g),xs=o.map(p=>p.x),ys=o.map(p=>p.y),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
    const cs=[Grid.cell(g,x0,y0),Grid.cell(g,x1,y0),Grid.cell(g,x0,y1),Grid.cell(g,x1,y1)],qa=Math.min(...cs.map(c=>c.q))-1,qb=Math.max(...cs.map(c=>c.q))+1,ra=Math.min(...cs.map(c=>c.r))-1,rb=Math.max(...cs.map(c=>c.r))+1;
    const out=[];if((qb-qa+1)*(rb-ra+1)<=40000)for(let q=qa;q<=qb;q++)for(let r=ra;r<=rb;r++){const m=Grid.center(g,{q,r});if(m.x<x0-Grid.size(g)||m.x>x1+Grid.size(g)||m.y<y0-Grid.size(g)||m.y>y1+Grid.size(g))continue;
      const sp=samples(g,{q,r});let n=0;for(const p of sp)if(contains(t,g,p.x,p.y))n++;if(n*2>=sp.length)out.push({q,r})}
    if(cellCache.size>300)cellCache.clear();cellCache.set(key,out);return out}
  /* is this token caught, by the game's rule? */
  function catches(t,g,tok){const r=Grid.tokR(g,tok.size),how=Grid.type(g)==="none"&&rule()==="cells"?"centre":rule();
    if(how==="centre")return contains(t,g,tok.x,tok.y);
    if(how==="touch")return distance(t,g,tok.x,tok.y)<r*.96;
    const cov=cells(t,g);if(!cov.length)return false;const has=c=>cov.some(k=>k.q===c.q&&k.r===c.r),c0=Grid.cell(g,tok.x,tok.y);
    if((Math.round(Number(tok.size)||1)%2)===1&&has(c0))return true;
    // bigger tokens: any cell whose middle is under the token
    const reach=Math.ceil((Number(tok.size)||1)/2)+1;
    for(let dq=-reach;dq<=reach;dq++)for(let dr=-reach;dr<=reach;dr++){const c={q:c0.q+dq,r:c0.r+dr},m=Grid.center(g,c);if(Math.hypot(m.x-tok.x,m.y-tok.y)<r*.99&&has(c))return true}
    return false}
  const caught=(t,g,tokens)=>(tokens||[]).filter(k=>catches(t,g,k));
  /* "Fireball · 20 ft" */
  function describe(t,g){const u=Grid.unit(g),per=Grid.per(g),n=v=>{const r=Math.round(v*per*10)/10;return Math.abs(r-Math.round(r))<.05?String(Math.round(r)):r.toFixed(1)};
    const what=t.shape==="line"?`${n(t.size)} × ${n(t.width)} ${u} line`:t.shape==="circle"?`${n(t.size)} ${u} radius`:`${n(t.size)} ${u} ${t.shape}`;
    return t.label?`${t.label} · ${what}`:what.charAt(0).toUpperCase()+what.slice(1)}
  return {SHAPES,RULES,rule,coneHalf,clean,presets,snapOrigin,outline,endPoint,contains,distance,cells,catches,caught,describe};
})();
