/* ============================== MONOLITH: THE GAME SHELF ==============================
   First screen. Installed games stand as slabs; choose one, then Player or GM. Opening a game
   first checks that game's own repository for a newer release and installs it if there is one.
   Games that are approved but not installed are under More games. */
const L=window.monolithDesk&&window.monolithDesk.claim?window.monolithDesk.claim():null;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const LS_={open:null,busy:{},status:{},state:null};
function toast(t){const h=document.getElementById("toast-host");h.innerHTML=`<div class="toast" role="status"><div><div class="lbl">${esc(t)}</div></div></div>`;clearTimeout(toast.t);toast.t=setTimeout(()=>h.innerHTML="",4500)}
function mb(n){return n?(n/1048576).toFixed(n<1048576?2:1)+" MB":""}
function setsOf(g){return (g.rulesets||[]).map(r=>r.name).join(", ")}
function slab(g,installed){
  const id=g.id;const busy=LS_.busy[id];const st=LS_.status[id]||{};const open=LS_.open===id&&!busy;
  const v=installed?g.installed.version:(g.available&&g.available.version)||"";
  const upd=installed&&g.available&&g.available.newer;
  const fill=busy?`<span class="fill" style="height:calc((100% - 44px) * ${Math.max(.04,(st.pct||0)/100)})"></span>`:"";
  let lower="";
  if(busy)lower=`<div class="slab-status" role="status">${esc(st.msg||"Working…")}</div>`;
  else if(open)lower=`<div class="slab-choose">
      <button class="btn primary" data-act="l-open" data-id="${esc(id)}" data-role="player">Player<small>Build and play your characters</small></button>
      <button class="btn" data-act="l-open" data-id="${esc(id)}" data-role="gm">Game master<small>Run campaigns and host the table</small></button></div>
      <button class="btn sm ghost slab-x" data-act="l-close" aria-label="Close">×</button>`;
  else if(!installed)lower=`<div class="slab-choose"><button class="btn primary" data-act="l-install" data-id="${esc(id)}">Install</button></div>`;
  if(!busy&&st.err)lower+=`<div class="slab-status bad">${esc(st.err)}</div>`;
  const tag=g.tagline?`<div class="slab-tag">${esc(g.tagline)}</div>`:"";
  return `<article class="slab ${installed?"go":"ghost"}${open?" open":""}${busy?" busy":""}" ${installed&&!busy&&!open?`data-act="l-pick" data-id="${esc(id)}" role="button" tabindex="0" aria-label="${esc(g.name)}"`:""}>
    ${fill}<h2 class="slab-name">${esc(g.name)}</h2><div class="slab-sets">${esc(setsOf(g))}</div>${open||!installed?tag:""}
    <div class="slab-meta"><span>${installed?"Version "+esc(v):v?"Version "+esc(v)+(g.available.size?" · "+mb(g.available.size):""):""}</span>${upd?`<span>Version ${esc(g.available.version)} installs when you open it</span>`:""}${g.dev?`<span>Loaded from a folder (developer copy)</span>`:""}</div>
    ${lower}</article>`}
function draw(){const s=LS_.state;if(!s)return;
  document.getElementById("l-ver").textContent="Version "+s.appVersion;
  const mine=s.games.filter(g=>g.installed),more=s.games.filter(g=>!g.installed&&g.available);
  const box=document.getElementById("slabs");
  box.innerHTML=mine.length?mine.map(g=>slab(g,true)).join(""):`<div class="l-empty"><h2>No games yet</h2><p class="muted" style="margin:0">${more.length?"Install one from More games below. It takes a few seconds.":s.listError?"Monolith couldn't reach its list of games: "+esc(s.listError)+" Check your internet connection, then try again.":"No games are available yet."}</p>${s.listError?`<div class="row"><button class="btn" data-act="l-refresh">Try again</button></div>`:""}</div>`;
  const m=document.getElementById("more");m.hidden=!more.length;document.getElementById("slabs-more").innerHTML=more.map(g=>slab(g,false)).join("")}
async function refresh(force){if(!L)return;try{LS_.state=await L.shelf(!!force)}catch(e){LS_.state={appVersion:"",games:[],listError:String(e.message||e)}}draw()}
const ACT={
  "l-pick":el=>{LS_.open=el.dataset.id;draw();setTimeout(()=>document.querySelector('[data-act="l-open"]')?.focus(),20)},
  "l-close":()=>{LS_.open=null;draw()},
  "l-refresh":()=>refresh(true),
  "l-open":async el=>{const id=el.dataset.id,role=el.dataset.role;LS_.busy[id]=true;LS_.status[id]={msg:"Checking for a newer version…",pct:8};draw();
    try{const r=await L.openGame(id,role);if(r&&r.ok)return;LS_.status[id]={err:(r&&r.msg)||"The game couldn't be opened."}}
    catch(e){LS_.status[id]={err:String(e.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/,"")}}
    LS_.busy[id]=false;draw()},
  "l-install":async el=>{const id=el.dataset.id;LS_.busy[id]=true;LS_.status[id]={msg:"Downloading…",pct:4};draw();
    try{const r=await L.installGame(id);if(!r||!r.ok)LS_.status[id]={err:(r&&r.msg)||"The game couldn't be installed."};else{LS_.status[id]={};toast(`${r.name||"The game"} is installed.`);LS_.open=id}}
    catch(e){LS_.status[id]={err:String(e.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/,"")}}
    LS_.busy[id]=false;await refresh(false)},
  "l-update":()=>L&&L.checkAppUpdate(),
  "l-data":()=>L&&L.openData(),
};
document.addEventListener("click",ev=>{const el=ev.target.closest("[data-act]");if(!el||el.disabled)return;const f=ACT[el.dataset.act];if(f){ev.preventDefault();f(el,ev)}});
document.addEventListener("keydown",ev=>{if((ev.key==="Enter"||ev.key===" ")&&ev.target.dataset&&ev.target.dataset.act==="l-pick"){ev.preventDefault();ACT["l-pick"](ev.target)}if(ev.key==="Escape"&&LS_.open){LS_.open=null;draw()}});
if(L&&L.onGameStatus)L.onGameStatus(s=>{if(!s||!s.id)return;LS_.status[s.id]={msg:s.msg,pct:s.pct};if(LS_.busy[s.id])draw()});
if(!L){document.getElementById("slabs").innerHTML=`<div class="l-empty"><h2>Open Monolith from the desktop app</h2><p class="muted" style="margin:0">This screen lists your installed games, which only the desktop app can do.</p></div>`}
else refresh(false);
