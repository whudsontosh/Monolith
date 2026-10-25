/* ============================== MONOLITH CORE: GAME LOADING & API ==============================
   A Monolith page (player.html or gm.html) holds the core. It asks the desktop app which game
   this window plays, loads that game's signed files from game://, and the game registers itself
   with Monolith.registerGame(). Games only ever see the Monolith object and the core helpers;
   the desktop bridge is claimed here, before any game code runs, and never handed to a game. */
const MONOLITH_API=1;
const Desk=(()=>{const raw=window.monolithDesk&&typeof window.monolithDesk.claim==="function"?window.monolithDesk.claim():null;
  if(!raw)return null;
  // only what the core screens need; each call is also checked by the app against the window that sent it
  const pick=["platform","appVersion","gameInfo","gameEnsure","serverInfo","hostState","tunnelStart","tunnelStop","onTunnel","directStart","directStop","lanIps","publicIp",
    "backup","openBackups","openData","copy","openPlayerWindow","savePdf","goHome","onUpdate","updateSkip"];
  const o={};for(const k of pick)if(raw[k]!==undefined)o[k]=raw[k];return Object.freeze(o)})();
const IS_MAC=Desk?Desk.platform==="darwin":/Mac/i.test(navigator.platform||"");
const ROLE=document.documentElement.dataset.role||"player";

/* settings shared by every Monolith screen on this computer */
const Settings={key:"monolith-settings",get(k,f){const s=LS.get(this.key,{})||{};return s[k]===undefined?f:s[k]},set(k,v){const s=LS.get(this.key,{})||{};s[k]=v;LS.set(this.key,s)}};

let GAME=null;   // the registered game definition
let RS=null;     // the active ruleset of that game
let GAME_INFO=null; // {id,name,version,...} from the manifest
const BOOT={started:false,onStart:null};

const Monolith={
  api:MONOLITH_API, role:ROLE,
  get game(){return GAME_INFO}, get rules(){return RS}, get gameDef(){return GAME},
  registerGame(def){
    if(GAME)throw new Error("A game is already loaded in this window.");
    if(!def||typeof def!=="object"||!def.id||!def.rulesets)throw new Error("The game didn't register properly.");
    if(GAME_INFO&&def.id!==GAME_INFO.id)throw new Error("The game's id doesn't match its manifest.");
    if((def.api||1)>MONOLITH_API)throw new Error("This game needs a newer version of Monolith.");
    GAME=def;const ids=Object.keys(def.rulesets);RS=def.rulesets[(GAME_INFO&&GAME_INFO.ruleset)||ids[0]]||def.rulesets[ids[0]];
    if(BOOT.onStart&&!BOOT.started){BOOT.started=true;try{BOOT.onStart()}catch(e){bootFail(e)}}
  },
  useRuleset(id){if(GAME&&GAME.rulesets[id])RS=GAME.rulesets[id];return RS},
  /* the game's own saved data, kept apart from everything else */
  store:{
    key(k){return `monolith-game-${GAME_INFO?GAME_INFO.id:"x"}-${k}`},
    get(k,f){return LS.get(this.key(k),f)},set(k,v){return lsSet(this.key(k),v)},del(k){LS.del(this.key(k))},
  },
  files:{download:(...a)=>downloadText(...a),downloadBlob:(...a)=>downloadBlob(...a),read:(...a)=>readFiles(...a),
    savePdf:name=>Desk&&Desk.savePdf?Desk.savePdf(name):Promise.resolve({saved:false}),canSavePdf:()=>!!(Desk&&Desk.savePdf)},
  theme:{map:{accent:"#ffffff",label:"#f4f4f2",font:'"Inter Tight","Segoe UI",sans-serif',mono:'"JetBrains Mono",ui-monospace,monospace'}},
  hooks:{},  // game-provided extras (see the game contract in the README)
};
window.Monolith=Monolith;

/* ---------- loading the game into this window ---------- */
function bootFail(e){console.error(e);const app=document.getElementById("app");
  if(app)app.innerHTML=`<div class="boot-fail"><span class="label">Monolith</span><h1>This game couldn't start</h1><p class="muted">${esc(e&&e.message||e)}</p><div class="row"><button class="btn primary" data-act="mono-home">Back to your games</button></div></div>`}
function loadScript(src){return new Promise((res,rej)=>{const s=document.createElement("script");s.src=src;s.onload=()=>res();s.onerror=()=>rej(new Error("Couldn't load "+src.split("/").pop()+"."));document.body.appendChild(s)})}
function loadCss(href){return new Promise(res=>{const l=document.createElement("link");l.rel="stylesheet";l.href=href;l.onload=()=>res();l.onerror=()=>res();document.head.appendChild(l)})}
async function bootGame(onStart){
  BOOT.onStart=onStart;
  try{
    let info=null;
    if(Desk&&Desk.gameInfo)info=await Desk.gameInfo();
    else{ // developer pages in a browser: ?devgame=<folder holding game.json>
      const base=new URLSearchParams(location.search).get("devgame");if(!base)throw new Error("No game was chosen for this window.");
      const b=base.endsWith("/")?base:base+"/";const m=await (await fetch(b+"game.json",{cache:"no-store"})).json();info={...m,base:b,dev:true}}
    if(!info||!info.id)throw new Error("No game was chosen for this window.");
    GAME_INFO=Object.freeze({...info});
    document.documentElement.dataset.game=info.id;
    const entry=info.entry&&info.entry[ROLE];if(!entry)throw new Error(`${info.name||"This game"} has no ${ROLE==="gm"?"GM":"player"} screens.`);
    if(info.css)for(const c of [].concat(info.css))await loadCss(info.base+c);
    if(info.skin)document.documentElement.dataset.skin=info.skin;
    for(const f of [].concat(entry))await loadScript(info.base+f);
    if(!GAME)throw new Error("The game didn't register itself.");
  }catch(e){bootFail(e)}
}

/* ---------- the frame every game page shares ---------- */
function frameBrand(){const g=GAME_INFO;
  // a game may bring its own wordmark (GAME.brand(role) -> html); the way home to Monolith stays
  const own=GAME&&typeof GAME.brand==="function"?GAME.brand(ROLE):"";
  if(own)return `<span class="mono-home" title="Back to your games">${icon("back")}<span class="mono-word">Monolith</span></span>${own}`;
  return `<span class="mono-mark" aria-hidden="true"></span><span class="mono-word">Monolith</span>${g?`<span class="mono-game">${esc(g.name)}${RS&&RS.name&&RS.name!==g.name?` · ${esc(RS.name)}`:""} · ${ROLE==="gm"?"GM":"Player"}</span>`:""}`}
function paintFrame(){const b=document.getElementById("brand");if(b)b.innerHTML=frameBrand();
  const fab=document.querySelector(".dice-fab");if(fab&&GAME&&GAME.diceLabel)fab.textContent=GAME.diceLabel;
  if(GAME_INFO)document.title=`${GAME_INFO.name} · ${ROLE==="gm"?"GM":"Player"} · Monolith`}
