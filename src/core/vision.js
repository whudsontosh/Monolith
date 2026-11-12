/* ============================== MONOLITH CORE: LIGHT AND SIGHT ==============================
   What each player can see (1.6). Only the GM's app runs this; players are sent pictures of the
   result, never the walls or the lights.

   On a map:
     vision   true | false | undefined   undefined = automatic: on once a wall, door or curtain exists
     ambient  "day" (default) | "dim" | "dark"
     lights   [{id, x, y, bright, dim, color, angle, dir}]   bright = reach of bright light, dim = how
              much further dim light goes, both in the map's units; angle (degrees, 360 = all round)
              and dir (radians) make a beam
     seen     a small picture (PNG data URL) of everywhere the party has seen so far
   On a token:
     sight    {range, dark}    how far it sees at all (empty = no limit) and how far it sees in
              the dark, in the map's units
     light    {bright, dim, color}   a light it carries
   Only tokens that belong to a player give sight. A game can fill sight and light in from the
   character by registering  map:{ sightFor(character, token){ return {dark:60, light:{bright:20,dim:20}} } };
   whatever the GM sets on the token wins.

   How a view is worked out: from each of a player's tokens, the outline of everything in a straight
   line of sight is found by casting rays at the ends of every sight-blocking wall. That outline is
   kept only where there is light (ambient light, or a light whose own rays reach), or within the
   token's dark sight. It is painted onto a small mask (about 8 pixels per cell), and the mask is all
   a player's app receives. Tokens, doors and templates outside it are not sent to that player. */
const Vision=(()=>{
  const AMBIENT=["day","dim","dark"],PX=8,MAXSIDE=960,TAU=Math.PI*2;
  const on=m=>!!m&&m.vision!==false&&(m.vision===true||(m.walls||[]).some(w=>w.kind==="wall"||w.kind==="door"||w.kind==="curtain"));
  const ambient=m=>AMBIENT.includes(m&&m.ambient)?m.ambient:"day";
  const num=(v,lo,hi)=>{v=Number(v);return isFinite(v)&&v>0?Math.max(lo,Math.min(hi,Math.round(v*100)/100)):0};
  const HEX=/^#[0-9a-fA-F]{6}$/;
  function cleanLight(d,m){if(!d||typeof d!=="object")return null;const x=Number(d.x),y=Number(d.y);if(!isFinite(x)||!isFinite(y))return null;const W=(m&&m.w)||4000,H=(m&&m.h)||4000;
    const l={id:String(d.id||"").replace(/[^A-Za-z0-9_-]/g,"").slice(0,40)||uid(),x:Math.round(Math.max(-W,Math.min(2*W,x))),y:Math.round(Math.max(-H,Math.min(2*H,y))),bright:num(d.bright,0,100000),dim:num(d.dim,0,100000),color:HEX.test(d.color||"")?d.color:"#ffd94a"};
    const a=Number(d.angle);if(a>=5&&a<355){l.angle=Math.round(a);l.dir=Math.round(((((Number(d.dir)||0)%TAU)+TAU)%TAU)*1000)/1000}
    return l.bright+l.dim>0?l:null}
  /* a map's lights, well-formed (lights from a 1.5 map import held only a reach in cells) */
  function lights(m){if(!m||!Array.isArray(m.lights))return [];const per=Grid.per(m.grid);
    return m.lights.map(l=>l&&l.bright==null&&l.dim==null&&l.r!=null?cleanLight({...l,bright:Number(l.r)*per/2,dim:Number(l.r)*per/2},m):cleanLight(l,m)).filter(Boolean)}
  const cleanSight=s=>{if(!s||typeof s!=="object")return null;const o={};const r=num(s.range,0,1e6),d=num(s.dark,0,1e6);if(r)o.range=r;if(d)o.dark=d;return o};
  const cleanTokLight=l=>{if(!l||typeof l!=="object")return null;const b=num(l.bright,0,1e5),d=num(l.dim,0,1e5);return b+d>0?{bright:b,dim:d,color:HEX.test(l.color||"")?l.color:"#ffd94a"}:null};
  /* a token's eyes and the light it carries: the GM's settings first, then the game's, then plain sight */
  function eyes(t,ch){let g=null;const f=typeof GAME!=="undefined"&&GAME&&GAME.map&&GAME.map.sightFor;
    if(typeof f==="function"&&ch)try{g=f(ch,{id:t.id,label:t.label,kind:t.kind})||null}catch(e){console.error(e)}
    const s=(t.sight&&cleanSight(t.sight))||cleanSight(g)||{},l=t.light?cleanTokLight(t.light):cleanTokLight(g&&g.light);
    return {range:s.range||0,dark:s.dark||0,light:l}}

  /* ---- line of sight ---- */
  /* the walls that stop sight, as [ax,ay,bx,by, ...] */
  function segments(m){const out=[];for(const w of m.walls||[])if(Walls.blocksSight(w))out.push(w.a[0],w.a[1],w.b[0],w.b[1]);return out}
  /* the outline of everything in a straight line from (ox,oy), no further than R: [x,y, x,y, ...] going round */
  function outline(S,ox,oy,R){const seg=[],x0=ox-R,x1=ox+R,y0=oy-R,y1=oy+R;
    for(let i=0;i<S.length;i+=4){const ax=S[i],ay=S[i+1],bx=S[i+2],by=S[i+3];
      if((ax<x0&&bx<x0)||(ax>x1&&bx>x1)||(ay<y0&&by<y0)||(ay>y1&&by>y1))continue;seg.push(ax,ay,bx,by)}
    seg.push(x0,y0,x1,y0, x1,y0,x1,y1, x1,y1,x0,y1, x0,y1,x0,y0); // a box at the edge of sight, so every ray ends somewhere
    const seen=new Set(),ang=[];
    for(let i=0;i<seg.length;i+=2){const px=seg[i],py=seg[i+1],k=Math.round(px*4)+","+Math.round(py*4);if(seen.has(k))continue;seen.add(k);
      const a=Math.atan2(py-oy,px-ox);ang.push(a-1e-4,a,a+1e-4)}
    ang.sort((a,b)=>a-b);const n=seg.length,out=new Array(ang.length*2);
    for(let j=0;j<ang.length;j++){const dx=Math.cos(ang[j]),dy=Math.sin(ang[j]);let best=Infinity;
      for(let i=0;i<n;i+=4){const ax=seg[i],ay=seg[i+1],sx=seg[i+2]-ax,sy=seg[i+3]-ay,den=dx*sy-dy*sx;if(den>-1e-12&&den<1e-12)continue;
        const t=((ax-ox)*sy-(ay-oy)*sx)/den;if(t<0||t>=best)continue;const u=((ax-ox)*dy-(ay-oy)*dx)/den;if(u<-1e-9||u>1+1e-9)continue;best=t}
      if(best===Infinity)best=R;out[j*2]=ox+dx*best;out[j*2+1]=oy+dy*best}
    return out}
  /* is b in a straight line of sight from a? (used by tests and available to games) */
  function clear(m,a,b){const S=segments(m),dx=b.x-a.x,dy=b.y-a.y;
    for(let i=0;i<S.length;i+=4){const sx=S[i+2]-S[i],sy=S[i+3]-S[i+1],den=dx*sy-dy*sx;if(Math.abs(den)<1e-12)continue;
      const t=((S[i]-a.x)*sy-(S[i+1]-a.y)*sx)/den,u=((S[i]-a.x)*dy-(S[i+1]-a.y)*dx)/den;if(t>1e-9&&t<1-1e-9&&u>=0&&u<=1)return false}
    return true}

  /* ---- masks ---- */
  const canvas=(w,h)=>{const c=document.createElement("canvas");c.width=w;c.height=h;return c};
  const scaleOf=m=>{const k=PX/Grid.size(m.grid),big=Math.max(m.w,m.h)*k;return big>MAXSIDE?k*MAXSIDE/big:k};
  function trace(c,P,k){c.beginPath();for(let i=0;i<P.length;i+=2)i?c.lineTo(P[i]*k,P[i+1]*k):c.moveTo(P[i]*k,P[i+1]*k);c.closePath()}
  /* a short description of everything a view depends on: when it hasn't changed, nothing is worked out again */
  function key(m,eyesOf){let s=ambient(m)+"|"+Grid.size(m.grid)+"|"+Grid.per(m.grid)+"|"+m.w+"x"+m.h+"|";
    for(const w of m.walls||[])if(Walls.blocksSight(w))s+=w.a[0]+","+w.a[1]+","+w.b[0]+","+w.b[1]+";";
    for(const l of lights(m))s+="L"+l.x+","+l.y+","+l.bright+","+l.dim+","+(l.angle||0)+","+(l.dir||0)+";";
    for(const t of m.tokens||[]){if(t.hidden)continue;const e=eyesOf(t);if(!t.owner&&!e.light)continue;s+="T"+t.id+","+t.x+","+t.y+","+(t.size||1)+","+(t.owner||"")+","+e.range+","+e.dark+","+(e.light?e.light.bright+"/"+e.light.dim:"")+";"}
    return s}
  /* work out everyone's view of a map.
     eyesOf(token) -> {range, dark, light}. Returns {k, w, h, lit, party, by:{playerId: canvas}} */
  function compute(m,eyesOf){const g=m.grid,k=scaleOf(m),W=Math.max(1,Math.ceil(m.w*k)),H=Math.max(1,Math.ceil(m.h*k)),S=segments(m),px=v=>v/Grid.per(g)*Grid.size(g),far=Math.hypot(m.w,m.h)*1.5+100;
    const lit=canvas(W,H),lc=lit.getContext("2d"),amb=ambient(m);
    if(amb!=="dark"){lc.globalAlpha=amb==="day"?1:.6;lc.fillStyle="#000";lc.fillRect(0,0,W,H);lc.globalAlpha=1}
    const glow=(x,y,bright,dim,angle,dir)=>{const R=px(bright+dim);if(!(R>0))return;const P=outline(S,x,y,R+2);lc.save();trace(lc,P,k);lc.clip();
      if(angle){lc.beginPath();lc.moveTo(x*k,y*k);lc.arc(x*k,y*k,R*k+2,dir-angle*Math.PI/360,dir+angle*Math.PI/360);lc.closePath();lc.clip()}
      const gr=lc.createRadialGradient(x*k,y*k,0,x*k,y*k,Math.max(1,R*k)),b=Math.min(.98,px(bright)/R);gr.addColorStop(0,"rgba(0,0,0,1)");gr.addColorStop(Math.max(.01,b),"rgba(0,0,0,1)");
      gr.addColorStop(Math.min(.995,b+(1-b)*.25+.004),"rgba(0,0,0,.62)");gr.addColorStop(.97,"rgba(0,0,0,.5)");gr.addColorStop(1,"rgba(0,0,0,0)");
      lc.fillStyle=gr;lc.beginPath();lc.arc(x*k,y*k,R*k,0,TAU);lc.fill();lc.restore()};
    for(const l of lights(m))glow(l.x,l.y,l.bright,l.dim,l.angle||0,l.dir||0);
    const viewers=[];
    for(const t of m.tokens||[]){if(t.hidden)continue;const e=eyesOf(t);if(e.light)glow(t.x,t.y,e.light.bright,e.light.dim,0,0);if(t.owner)viewers.push([t,e])}
    const by={},party=canvas(W,H),pc=party.getContext("2d"),tmp=canvas(W,H),tc=tmp.getContext("2d");
    for(const [t,e] of viewers){const R=e.range?px(e.range):far,P=outline(S,t.x,t.y,Math.min(R,far)+2);
      tc.clearRect(0,0,W,H);tc.save();trace(tc,P,k);tc.clip();
      if(e.range){tc.beginPath();tc.arc(t.x*k,t.y*k,R*k,0,TAU);tc.clip()}
      tc.drawImage(lit,0,0);
      if(e.dark){const D=px(e.dark)*k,gr=tc.createRadialGradient(t.x*k,t.y*k,0,t.x*k,t.y*k,Math.max(1,D));gr.addColorStop(0,"rgba(0,0,0,.8)");gr.addColorStop(.9,"rgba(0,0,0,.7)");gr.addColorStop(1,"rgba(0,0,0,0)");
        tc.fillStyle=gr;tc.beginPath();tc.arc(t.x*k,t.y*k,D,0,TAU);tc.fill()}
      tc.restore();
      // a token always makes out the spot it stands on
      tc.fillStyle="#000";tc.beginPath();tc.arc(t.x*k,t.y*k,Math.max(2,Grid.tokR(g,t.size)*1.25*k),0,TAU);tc.fill();
      const c=by[t.owner]||(by[t.owner]=canvas(W,H));c.getContext("2d").drawImage(tmp,0,0);pc.drawImage(tmp,0,0)}
    return {k,w:W,h:H,lit,party,by,alpha:{}}}
  /* how clearly a spot shows in a mask, 0 to 255 */
  function alphaAt(V,who,x,y){const c=who==="seen"?V.seen:(who&&V.by[who])||V.party;if(!c)return 0;
    let d=V.alpha[who||"*"];if(!d){d=V.alpha[who||"*"]=c.getContext("2d",{willReadFrequently:true}).getImageData(0,0,c.width,c.height).data}
    const ix=Math.floor(x*V.k),iy=Math.floor(y*V.k);if(ix<0||iy<0||ix>=c.width||iy>=c.height)return 0;return d[(iy*c.width+ix)*4+3]}
  /* can this player make out a token (its middle, or a good part of its edge)? */
  function sees(V,who,g,t){const r=Grid.tokR(g,t.size)*.6;if(alphaAt(V,who,t.x,t.y)>24)return true;
    for(let i=0;i<4;i++){const a=Math.PI/4+i*Math.PI/2;if(alphaAt(V,who,t.x+r*Math.cos(a),t.y+r*Math.sin(a))>24)return true}return false}
  const seesPoint=(V,who,x,y)=>alphaAt(V,who,x,y)>24;

  /* ---- drawing the result (the player's map, and the GM's preview) ---- */
  let shade=null;
  /* darkness over a map: black where nobody has been, dimmed where the party has been, clear where `vis` shows.
     c is in map coordinates; vis and seen are pictures of the whole map. */
  function drawDark(c,m,vis,seen){const k=vis?vis.width/m.w:seen?seen.width/m.w:0;if(!k)return;const W=Math.max(1,Math.ceil(m.w*k)),H=Math.max(1,Math.ceil(m.h*k));
    if(!shade||shade.width!==W||shade.height!==H)shade=canvas(W,H);const s=shade.getContext("2d");
    s.globalCompositeOperation="source-over";s.globalAlpha=1;s.fillStyle="#04050a";s.fillRect(0,0,W,H);s.globalCompositeOperation="destination-out";
    if(seen&&seen.width){s.globalAlpha=.5;s.drawImage(seen,0,0,W,H)}
    if(vis&&vis.width){s.globalAlpha=1;s.drawImage(vis,0,0,W,H)}
    s.globalCompositeOperation="source-over";s.globalAlpha=1;
    c.save();c.imageSmoothingEnabled=true;c.imageSmoothingQuality="high";c.drawImage(shade,0,0,m.w,m.h);c.restore()}
  return {AMBIENT,on,ambient,cleanLight,lights,cleanSight,cleanTokLight,eyes,segments,outline,clear,scaleOf,key,compute,alphaAt,sees,seesPoint,drawDark,canvas};
})();
