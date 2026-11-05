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
  const DT=1/240,HOLD=1.3,FADE=.45,MAXT=4.5; // seconds
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

  /* ---- the throw: a small physics simulation, run in full before the first frame ----
     Dice leave the dice button, fly, bounce on the table, roll with friction, hit each other and
     the four edges of the window, and come to rest. Rotation comes from the motion (a rolling die
     turns as it travels). The simulation is run first and then "rewound": each die starts turned
     so that, after all the spinning it is about to do, it rests on the rolled face. */
  function simulate(list,R){
    const n=list.length,diag=Math.hypot(W,H),m=R*1.05,g=R*60,rest=R*.5,STEPS=Math.round(MAXT/DT);
    const B=list.map((_,i)=>{const a=.1+rnd()*1.05,sp=diag*Math.sqrt(2*.55*(.15+rnd()*.95)); // speed for a random travel distance
      const ax=norm([rnd()-.5,rnd()-.5,rnd()-.5]),w=10+rnd()*8;
      return {x:W-m-R*.4-rnd()*R*1.5-(i%4)*R*.7,y:H-m-R*.4-rnd()*R*1.5-Math.floor(i/4)*R*.7,z:R*(.4+rnd()*.5),
        vx:-Math.cos(a)*sp,vy:-Math.sin(a)*sp,vz:R*(3.5+rnd()*3.5),w:mul(ax,w),Q:[[1,0,0],[0,1,0],[0,0,1]],
        path:[],still:false,restAt:STEPS}});
    let step=0;
    for(;step<STEPS;step++){
      const t=step*DT,late=t>MAXT*.7;
      for(const b of B){if(b.still){b.path.push([b.x,b.y,0,b.Q]);continue}
        // height: gravity and bounces on the table
        b.vz-=g*DT;b.z+=b.vz*DT;
        if(b.z<=0){b.z=0;if(b.vz<0){b.vz=-b.vz*.42;if(b.vz<R*2.2)b.vz=0}}
        const ground=b.z<=0&&b.vz===0,touch=b.z<=R*.02;
        // sliding and rolling friction on the table, a little drag in the air
        const sp=Math.hypot(b.vx,b.vy);
        if(touch){const dec=diag*.55*DT,k=sp>0?Math.max(0,sp-dec)/sp:0,f=Math.exp(-1.4*DT)*(late?Math.exp(-6*DT):1);b.vx*=k*f;b.vy*=k*f}
        else{const f=Math.exp(-.15*DT);b.vx*=f;b.vy*=f}
        b.x+=b.vx*DT;b.y+=b.vy*DT;
        // the edges of the window are walls (the top one counts the die's height above the table)
        if(b.x<m){b.x=m;b.vx=Math.abs(b.vx)*.7;b.w=mul(b.w,.85)}
        if(b.x>W-m){b.x=W-m;b.vx=-Math.abs(b.vx)*.7;b.w=mul(b.w,.85)}
        if(b.y-b.z*1.1<m){b.y=m+b.z*1.1;b.vy=Math.abs(b.vy)*.7;b.w=mul(b.w,.85)}
        if(b.y>H-m){b.y=H-m;b.vy=-Math.abs(b.vy)*.7;b.w=mul(b.w,.85)}
      }
      // dice knock into each other
      for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){const A=B[i],C=B[j];if(Math.abs(A.z-C.z)>R)continue;
        let dx=C.x-A.x,dy=C.y-A.y,dd=Math.hypot(dx,dy)||.01;const min=R*1.9;if(dd>=min)continue;
        dx/=dd;dy/=dd;const push=(min-dd)/2;
        if(!A.still){A.x-=dx*push;A.y-=dy*push}if(!C.still){C.x+=dx*push;C.y+=dy*push}
        const rel=(C.vx-A.vx)*dx+(C.vy-A.vy)*dy;
        if(rel<0){const J=-(1.6)*rel/2;A.vx-=J*dx;A.vy-=J*dy;C.vx+=J*dx;C.vy+=J*dy;
          if(A.still&&Math.hypot(A.vx,A.vy)>rest*3)A.still=false;if(C.still&&Math.hypot(C.vx,C.vy)>rest*3)C.still=false}}
      for(const b of B){if(b.still)continue;
        const sp=Math.hypot(b.vx,b.vy),ground=b.z<=0&&b.vz===0;
        // spin: on the table it settles into rolling along the direction of travel
        if(b.z<=R*.02){const roll=[b.vy/R,b.vx/R,0];const k=Math.min(1,DT*16);b.w=add(b.w,mul(sub(roll,b.w),k))}
        else b.w=mul(b.w,Math.exp(-.25*DT));
        const wl=len(b.w);if(wl>1e-6)b.Q=mm(axisAngle(b.w,wl*DT),b.Q);
        if(ground&&sp<rest&&wl<.6){b.vx=b.vy=0;b.w=[0,0,0];b.still=true;b.restAt=step}
        b.path.push([b.x,b.y,b.z,b.Q])}
      if(B.every(b=>b.still))break}
    const N=Math.min(step+1,STEPS);
    for(const b of B){b.path.length=Math.min(b.path.length,N);if(!b.still){b.restAt=N-1}}
    return {B,N}}

  function start(faces){
    if(!enabled()||typeof document==="undefined"||!document.body)return false;
    const P=plan(faces);if(!P.length)return false;
    canvas();size();
    const n=P.length,R=clamp(Math.min(W,H)*.055,24,52)*(n>6?.72:n>3?.86:1);
    const {B,N}=simulate(P,R);
    dice=P.map((p,i)=>{
      const S=solidFor(p.s),labels=labelsFor(p.s,p.kind);
      const fi=Math.max(0,labels.indexOf(p.label)),F=S.faces[fi];
      // the resting turn: rolled face toward the viewer, number upright, with a little twist
      const tw=(rnd()-.5)*.7,cz=Math.cos(tw),sz=Math.sin(tw);
      const Bv=[F.right,F.up,F.n],T=[[cz,sz,0],[-sz,cz,0],[0,0,1]];
      const Rf=[[0,0,0],[0,0,0],[0,0,0]];for(let r=0;r<3;r++)for(let c=0;c<3;c++)Rf[r][c]=T[0][r]*Bv[0][c]+T[1][r]*Bv[1][c]+T[2][r]*Bv[2][c];
      // rewind: start turned so the simulated spin ends exactly at Rf
      const b=B[i],QT=b.path[b.path.length-1][3],QTt=[[QT[0][0],QT[1][0],QT[2][0]],[QT[0][1],QT[1][1],QT[2][1]],[QT[0][2],QT[1][2],QT[2][2]]];
      return {p,S,labels,R,fi,path:b.path,restAt:b.restAt,C:mm(QTt,Rf),look:lookFor(p.s)}});
    endT=N*DT;t0=performance.now();cancelAnimationFrame(raf);raf=requestAnimationFrame(frame);
    window.removeEventListener("resize",size);window.addEventListener("resize",size);
    return true}
  let endT=0;
  function stop(){cancelAnimationFrame(raf);raf=0;dice=[];if(cv){cv.remove();cv=null}window.removeEventListener("resize",size)}

  function frame(now){
    const t=Math.max(0,(now-t0)/1000);if(t>endT+HOLD+FADE+.1){stop();return}
    ctx.setTransform(DPR,0,0,DPR,0,0);ctx.clearRect(0,0,W,H);
    ctx.globalAlpha=t>endT+HOLD?clamp(1-(t-endT-HOLD)/FADE,0,1):1;
    // between two simulation steps, ease the position so motion stays smooth at any frame rate
    const f=t/DT,k=Math.floor(f),u=f-k;
    const at=D=>{const L=D.path.length-1,a=D.path[Math.min(k,L)],b=D.path[Math.min(k+1,L)];
      return {x:a[0]+(b[0]-a[0])*u,y:a[1]+(b[1]-a[1])*u,z:a[2]+(b[2]-a[2])*u,Q:a[3],still:k>=D.restAt}};
    const S=dice.map(D=>({D,s:at(D)})).sort((p,q)=>(p.s.y-p.s.z*.5)-(q.s.y-q.s.z*.5));
    for(const o of S)drawDie(o.D,o.s);
    ctx.globalAlpha=1;raf=requestAnimationFrame(frame)}
  function drawDie(D,st){
    const x=st.x,y=st.y,hop=clamp(st.z/D.R,0,3),u=st.still?1:0;
    const R=D.R*(1+hop*.12);
    const M=mm(VIEW,mm(st.Q,D.C));
    // shadow on the table
    ctx.save();ctx.globalAlpha*=.38/(1+hop*.6);ctx.fillStyle="#000";ctx.beginPath();
    ctx.ellipse(x+D.R*.12,y+D.R*.55,D.R*(1-hop*.12),D.R*.42*(1-hop*.12),0,0,Math.PI*2);ctx.fill();ctx.restore();
    const cy=y-st.z*1.1,F=6;
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
      const chosen=o.i===D.fi&&u>=1;
      ctx.save();ctx.globalAlpha*=clamp(o.n[2]*2.4,0,1);
      const k=1/100;ctx.transform((rx[0]-c[0])*k,(rx[1]-c[1])*k,(uy[0]-c[0])*k,(uy[1]-c[1])*k,c[0],c[1]);
      ctx.font=`600 ${lab.length>1?78:100}px ${L.font}`;ctx.textAlign="center";ctx.textBaseline="middle";
      const w=ctx.measureText(lab+mark).width;if(w>150){const z=150/w;ctx.scale(z,z)}
      ctx.fillStyle=chosen&&D.p.top&&L.high?L.high:chosen&&D.p.bottom&&L.low?L.low:L.text;
      ctx.fillText(lab+mark,0,6);ctx.restore()}
  }
  return {start,stop,enabled,plan,get busy(){return !!raf},get count(){return dice.length},
    // for the tests: where each die stops, and how far its rolled face is from facing the viewer
    _rest(){const Z=mv(VIEW,[0,0,1]);return dice.map(D=>{const e=D.path[D.path.length-1],F=D.S.faces[D.fi];return {x:e[0],y:e[1],w:W,h:H,t:D.restAt*DT,face:1-dot(mv(VIEW,mv(mm(e[3],D.C),F.n)),Z)}})},_solid:solidFor,_labels:labelsFor};
})();
CHANGE.dice3d=el=>{Settings.set("dice3d",!!el.checked);if(!el.checked)Dice3D.stop()};
