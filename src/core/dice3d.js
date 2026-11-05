/* ============================== MONOLITH CORE: 3D DICE ==============================
   When you roll, the dice you rolled tumble across your own screen and land showing the numbers
   the roll already produced. The animation never decides anything: the core's d() picks every
   number, notes it (DiceCap in util.js), and Dice.push hands those numbers here. Other people at
   the table only get the result in their log; nothing about the animation goes over the network.

   Drawn on one see-through canvas with a small hand-made renderer (flat-shaded convex solids),
   so it needs no 3D library and no graphics card features. Off with the tray's "3D dice" switch,
   and off by default when the computer asks for reduced motion.

   A game can give its dice a look by registering `dice` (see the README):
     dice:{body,edge,text,high,low,font,edgeWidth, sides:{"20":{body,...}}}            */
const Dice3D=(()=>{
  const SUPPORTED=[4,6,8,10,12,20,100];
  const MAX=12;
  /* ---- tiny vector helpers ---- */
  const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],mul=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const len=a=>Math.hypot(a[0],a[1],a[2]),norm=a=>{const l=len(a)||1;return mul(a,1/l)};
  const mm=(A,B)=>{const C=[[0,0,0],[0,0,0],[0,0,0]];for(let i=0;i<3;i++)for(let j=0;j<3;j++)C[i][j]=A[i][0]*B[0][j]+A[i][1]*B[1][j]+A[i][2]*B[2][j];return C};
  const mv=(M,v)=>[M[0][0]*v[0]+M[0][1]*v[1]+M[0][2]*v[2],M[1][0]*v[0]+M[1][1]*v[1]+M[1][2]*v[2],M[2][0]*v[0]+M[2][1]*v[1]+M[2][2]*v[2]];
  function axisAngle(ax,t){const [x,y,z]=norm(ax),c=Math.cos(t),s=Math.sin(t),C=1-c;
    return [[c+x*x*C,x*y*C-z*s,x*z*C+y*s],[y*x*C+z*s,c+y*y*C,y*z*C-x*s],[z*x*C-y*s,z*y*C+x*s,c+z*z*C]]}
  /* its own random numbers, so the animation never uses up Math.random (the tests rig that) */
  let seed=(Date.now()^0x9e3779b9)>>>0;
  const rnd=()=>{seed=(seed+0x6D2B79F5)>>>0;let t=seed;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296};

  /* ---- the solids ---- */
  function solid(verts,faceSets,kite){
    const R0=Math.max(...verts.map(len)),V=verts.map(v=>mul(v,1/R0));
    const faces=faceSets.map(set=>{
      const c=mul(set.reduce((a,i)=>add(a,V[i]),[0,0,0]),1/set.length);
      const ax=norm(c),ref=Math.abs(ax[2])<.9?[0,0,1]:[1,0,0],e1=norm(cross(ax,ref)),e2=cross(ax,e1);
      const idx=[...set].sort((a,b)=>{const pa=sub(V[a],c),pb=sub(V[b],c);return Math.atan2(dot(pa,e2),dot(pa,e1))-Math.atan2(dot(pb,e2),dot(pb,e1))});
      let n=[0,0,0];for(let i=0;i<idx.length;i++){const p=V[idx[i]],q=V[idx[(i+1)%idx.length]];n=add(n,[(p[1]-q[1])*(p[2]+q[2]),(p[2]-q[2])*(p[0]+q[0]),(p[0]-q[0])*(p[1]+q[1])])}
      n=norm(n);if(dot(n,c)<0){n=mul(n,-1);idx.reverse()}
      // which way the number reads: towards the kite's point, a square's edge, or a corner
      let up;
      if(kite){const tip=idx.reduce((b,i)=>Math.abs(V[i][2])>Math.abs(V[b][2])?i:b,idx[0]);up=sub(V[tip],c)}
      else if(idx.length===4)up=sub(mul(add(V[idx[0]],V[idx[1]]),.5),c);
      else up=sub(V[idx[0]],c);
      up=norm(sub(up,mul(n,dot(up,n))));
      let r=Infinity;for(let i=0;i<idx.length;i++){const p=V[idx[i]],q=V[idx[(i+1)%idx.length]],e=sub(q,p),w=sub(c,p);r=Math.min(r,len(cross(e,w))/len(e))}
      if(kite)r*=1.15;
      return {idx,c,n,up,right:cross(up,n),r};
    });
    return {V,faces};
  }
  const PHI=(1+Math.sqrt(5))/2;
  function icosa(){const v=[];for(const a of[-1,1])for(const b of[-PHI,PHI]){v.push([0,a,b],[a,b,0],[b,0,a])}
    const f=[];for(let i=0;i<12;i++)for(let j=i+1;j<12;j++)for(let k=j+1;k<12;k++){const e=(p,q)=>Math.abs(len(sub(v[p],v[q]))-2)<1e-6;if(e(i,j)&&e(j,k)&&e(i,k))f.push([i,j,k])}
    return {v,f}}
  const BUILD={
    4:()=>solid([[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]],[[0,1,2],[0,1,3],[0,2,3],[1,2,3]]),
    6:()=>{const v=[];for(const x of[-1,1])for(const y of[-1,1])for(const z of[-1,1])v.push([x,y,z]);
      const f=[];for(let ax=0;ax<3;ax++)for(const s of[-1,1])f.push(v.map((p,i)=>p[ax]===s?i:-1).filter(i=>i>=0));return solid(v,f)},
    8:()=>{const v=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];const f=[];for(const x of[0,1])for(const y of[2,3])for(const z of[4,5])f.push([x,y,z]);return solid(v,f)},
    20:()=>{const {v,f}=icosa();return solid(v,f)},
    12:()=>{const {v,f}=icosa();const cent=f.map(t=>norm(t.reduce((a,i)=>add(a,v[i]),[0,0,0])));
      return solid(cent,v.map((_,vi)=>f.map((t,fi)=>t.includes(vi)?fi:-1).filter(i=>i>=0)))},
    10:()=>{const a=.105,c=Math.cos(Math.PI/5),h=a*(1+c)/(1-c);const v=[[0,0,h],[0,0,-h]];
      for(let k=0;k<5;k++){const t=k*2*Math.PI/5;v.push([Math.cos(t),Math.sin(t),a])}
      for(let k=0;k<5;k++){const t=k*2*Math.PI/5+Math.PI/5;v.push([Math.cos(t),Math.sin(t),-a])}
      const f=[];for(let k=0;k<5;k++){f.push([0,2+k,7+k,2+(k+1)%5]);f.push([1,7+k,2+(k+1)%5,7+(k+1)%5])}
      return solid(v,f,true)},
  };
  const SOLIDS={};const solidFor=s=>SOLIDS[s]||(SOLIDS[s]=BUILD[s]());
  const labelsFor=(s,kind)=>{const n=s===100?10:s;const L=[];for(let i=1;i<=n;i++)L.push(String(i));
    if(kind==="tens")return L.map((_,i)=>i===9?"00":String((i+1)*10));
    if(kind==="units")return L.map((_,i)=>i===9?"0":String(i+1));
    return L};

  /* ---- the look: Monolith's own colors and font, then the game's ---- */
  const COLOR_OK=x=>typeof x==="string"&&x.length<=60&&(typeof CSS==="undefined"||!CSS.supports||CSS.supports("color",x));
  function cssVar(n,f){try{const v=getComputedStyle(document.documentElement).getPropertyValue(n).trim();return v||f}catch(e){return f}}
  function cleanLook(o){const L={};if(!o||typeof o!=="object")return L;
    for(const k of["body","edge","text","high","low"])if(COLOR_OK(o[k]))L[k]=o[k];
    if(typeof o.font==="string"&&o.font.length<=120&&!/[;{}<>]/.test(o.font))L.font=o.font;
    if(Number.isFinite(+o.edgeWidth))L.edgeWidth=clamp(+o.edgeWidth,0,4);
    return L}
  function lookFor(sides){
    const base={body:cssVar("--panel2","#141516"),edge:cssVar("--ink","#ecebe6"),text:cssVar("--ink","#ecebe6"),high:"",low:"",font:cssVar("--f-display","sans-serif"),edgeWidth:1.2};
    const g=(typeof GAME!=="undefined"&&GAME&&GAME.dice)||null;
    const per=g&&g.sides&&typeof g.sides==="object"?g.sides[String(sides)]:null;
    return {...base,...cleanLook(g),...cleanLook(per)}}
  function rgb(col){const cv=rgb.cv||(rgb.cv=document.createElement("canvas").getContext("2d"));cv.fillStyle="#000";cv.fillStyle=col;const s=cv.fillStyle;
    if(s[0]==="#")return [parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16)];
    const m=s.match(/[\d.]+/g)||[0,0,0];return [+m[0],+m[1],+m[2]]}
  
  /* ---- the overlay ---- */
  let cv=null,ctx=null,dice=[],t0=0,raf=0,W=0,H=0,DPR=1;
  const ROLL=1150,HOLD=1500,FADE=450;
  const VIEW=axisAngle([1,0,0],-0.42); // the table is seen from slightly in front
  const LIGHT=norm([-.45,.6,.75]);
  function canvas(){if(cv&&cv.isConnected)return cv;
    cv=document.createElement("canvas");cv.className="dice3d";cv.setAttribute("aria-hidden","true");
    cv.style.cssText="position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:45";
    document.body.appendChild(cv);ctx=cv.getContext("2d");return cv}
  function size(){DPR=Math.min(2,window.devicePixelRatio||1);W=window.innerWidth;H=window.innerHeight;cv.width=Math.round(W*DPR);cv.height=Math.round(H*DPR)}
  const enabled=()=>{const s=Settings.get("dice3d",null);if(s!==null)return !!s;try{return !matchMedia("(prefers-reduced-motion: reduce)").matches}catch(e){return true}};

  /* which dice to show for the numbers a roll used */
  function plan(faces){const out=[];
    for(const f of faces||[]){if(!Array.isArray(f))continue;const s=+f[0],v=+f[1];if(!SUPPORTED.includes(s)||!(v>=1&&v<=s))continue;
      if(s===100){const tens=v===100||v<10?"00":String(Math.floor(v/10)*10),units=String(v%10);
        out.push({s:10,kind:"tens",label:tens,top:v===100},{s:10,kind:"units",label:units,top:v===100});}
      else out.push({s,label:String(v),top:v===s&&s>=6,bottom:v===1&&s>=6});
      if(out.length>=MAX)break}
    return out.slice(0,MAX)}

  function start(faces){
    if(!enabled()||typeof document==="undefined"||!document.body)return false;
    const P=plan(faces);if(!P.length)return false;
    canvas();size();
    const n=P.length,R=clamp(Math.min(W,H)*.06,26,56)*(n>6?.72:n>3?.86:1);
    // land in the open part of the window: left of the dice tray and the map's sidebar
    const tray=document.querySelector(".tray"),side=document.body.classList.contains("mapmode")?Math.min(parseFloat(cssVar("--map-side-w","420"))||420,W*.6):0;
    const right=Math.max(side,tray?W-tray.getBoundingClientRect().left:0),AW=Math.max(W*.45,W-right),mid=AW/2;
    const gap=R*2.5,perRow=Math.max(1,Math.min(n,Math.floor((AW*.8)/gap))),rows=Math.ceil(n/perRow);
    dice=P.map((p,i)=>{
      const S=solidFor(p.s),labels=labelsFor(p.s,p.kind);
      const fi=Math.max(0,labels.indexOf(p.label)),F=S.faces[fi];
      // turn the rolled face toward the viewer, number upright, with a little twist
      const tw=(rnd()-.5)*.7,cz=Math.cos(tw),sz=Math.sin(tw);
      const B=[F.right,F.up,F.n],T=[[cz,sz,0],[-sz,cz,0],[0,0,1]];
      const Rf=[[0,0,0],[0,0,0],[0,0,0]];for(let r=0;r<3;r++)for(let c=0;c<3;c++)Rf[r][c]=T[0][r]*B[0][c]+T[1][r]*B[1][c]+T[2][r]*B[2][c];
      const row=Math.floor(i/perRow),col=i%perRow,inRow=row===rows-1?n-row*perRow:perRow;
      const ex=mid+(col-(inRow-1)/2)*gap+(rnd()-.5)*R*.5,ey=H*.52+(row-(rows-1)/2)*gap+(rnd()-.5)*R*.4;
      const sx=W+R*2+rnd()*R*3,sy=H*(.55+rnd()*.35);
      const dir=norm([ex-sx,-(ey-sy),0]);
      return {p,S,labels,Rf,R,ex,ey,sx,sy,axis:cross([0,0,1],dir),spin:(3+rnd()*2.5)*Math.PI,delay:i*45,look:lookFor(p.s)}});
    t0=performance.now();cancelAnimationFrame(raf);raf=requestAnimationFrame(frame);
    window.removeEventListener("resize",size);window.addEventListener("resize",size);
    return true}
  function stop(){cancelAnimationFrame(raf);raf=0;dice=[];if(cv){cv.remove();cv=null}window.removeEventListener("resize",size)}

  const easeOut=t=>1-Math.pow(1-t,3);
  function frame(now){
    const t=now-t0;if(t>ROLL+HOLD+FADE+200){stop();return}
    ctx.setTransform(DPR,0,0,DPR,0,0);ctx.clearRect(0,0,W,H);
    const alpha=t>ROLL+HOLD?clamp(1-(t-ROLL-HOLD)/FADE,0,1):1;ctx.globalAlpha=alpha;
    for(const D of [...dice].sort((a,b)=>a.ey-b.ey))drawDie(D,clamp((t-D.delay)/ROLL,0,1));
    ctx.globalAlpha=1;raf=requestAnimationFrame(frame)}
  function drawDie(D,u){
    const e=easeOut(u),x=D.sx+(D.ex-D.sx)*e,y=D.sy+(D.ey-D.sy)*e;
    const hop=Math.abs(Math.sin(u*Math.PI*3.2))*Math.pow(1-u,1.6);  // bounces that die away
    const R=D.R*(1+hop*.35);
    const M=mm(VIEW,mm(axisAngle(D.axis,D.spin*(1-e)),D.Rf));
    // shadow on the table
    ctx.save();ctx.globalAlpha*=.38*(1-hop*.5);ctx.fillStyle="#000";ctx.beginPath();
    ctx.ellipse(x+R*.12+hop*R*.5,y+R*.55+hop*R*.6,R*(1-hop*.2),R*.42*(1-hop*.2),0,0,Math.PI*2);ctx.fill();ctx.restore();
    const cy=y-hop*R*1.1,F=6;
    const proj=v=>{const p=mv(M,v);const k=F/(F-p[2]);return [x+p[0]*R*k,cy-p[1]*R*k,p[2]]};
    const P=D.S.V.map(proj),L=D.look,body=D.rgb||(D.rgb=rgb(L.body)),lit=D.lit||(D.lit=rgb(L.edge));
    const vis=D.S.faces.map((f,i)=>({f,i,n:mv(M,f.n),z:mv(M,f.c)[2]})).filter(o=>o.n[2]>1e-3).sort((a,b)=>a.z-b.z);
    ctx.lineJoin="round";
    for(const o of vis){const {f}=o;
      ctx.beginPath();f.idx.forEach((vi,j)=>j?ctx.lineTo(P[vi][0],P[vi][1]):ctx.moveTo(P[vi][0],P[vi][1]));ctx.closePath();
      {const k=Math.max(0,dot(o.n,LIGHT)),m=.04+.2*k,dk=.75+.35*k;ctx.fillStyle=`rgb(${body.map((b,j)=>Math.round(clamp((b*(1-m)+lit[j]*m)*dk,0,255))).join(",")})`}ctx.fill();
      if(L.edgeWidth>0){ctx.strokeStyle=L.edge;ctx.lineWidth=L.edgeWidth;ctx.stroke()}
      // the number, laid flat on the face
      const lab=D.labels[o.i];if(!lab)continue;
      const c=proj(f.c),s=f.r*.95,rx=proj(add(f.c,mul(f.right,s))),uy=proj(add(f.c,mul(f.up,-s)));
      const mark=D.p.s>=8&&(lab==="6"||lab==="9")?".":"";
      const chosen=o.i===D.labels.indexOf(D.p.label)&&u>=1;
      ctx.save();ctx.globalAlpha*=clamp(o.n[2]*2.4,0,1);
      const k=1/100;ctx.transform((rx[0]-c[0])*k,(rx[1]-c[1])*k,(uy[0]-c[0])*k,(uy[1]-c[1])*k,c[0],c[1]);
      ctx.font=`600 ${lab.length>1?78:100}px ${L.font}`;ctx.textAlign="center";ctx.textBaseline="middle";
      const w=ctx.measureText(lab+mark).width;if(w>150){const z=150/w;ctx.scale(z,z)}
      ctx.fillStyle=chosen&&D.p.top&&L.high?L.high:chosen&&D.p.bottom&&L.low?L.low:L.text;
      ctx.fillText(lab+mark,0,6);ctx.restore()}
  }
  return {start,stop,enabled,plan,get busy(){return !!raf},get count(){return dice.length},_solid:solidFor,_labels:labelsFor};
})();
CHANGE.dice3d=el=>{Settings.set("dice3d",!!el.checked);if(!el.checked)Dice3D.stop()};
