/* ============================== MONOLITH CORE: SAVING ==============================
   Autosave lives in localStorage; version history in IndexedDB (one record per version,
   written in the background); backup files go to Documents/Monolith/backups via the app. */
const Versions={db:null,ok:false,ready:false,q:[],mem:{},fbKey:"",
  async init(fbKey){this.fbKey=fbKey;try{this.db=await new Promise((res,rej)=>{const r=indexedDB.open("monolith-versions",1);r.onupgradeneeded=()=>{const os=r.result.createObjectStore("v",{keyPath:"key"});os.createIndex("scope","scope")};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);r.onblocked=()=>rej(new Error("blocked"))});this.ok=true}
    catch(e){this.ok=false;this.mem=LS.get(fbKey,{})||{}}this.ready=true;const q=this.q;this.q=[];q.forEach(f=>f())},
  whenReady(){return this.ready?Promise.resolve():new Promise(r=>this.q.push(r))},
  _tx(mode){return this.db.transaction("v",mode).objectStore("v")},
  async listAll(prefix){ // -> {scope:[meta newest first]}
    const out={};
    if(!this.ok){for(const sc in this.mem)if(sc.startsWith(prefix))out[sc]=this.mem[sc].map(({data,...m})=>m);return out}
    await new Promise(res=>{const r=this._tx("readonly").openCursor();r.onsuccess=()=>{const cur=r.result;if(!cur){res();return}const v=cur.value;if(v.scope.startsWith(prefix)){(out[v.scope]||(out[v.scope]=[])).push({key:v.key,scope:v.scope,t:v.t,label:v.label,summary:v.summary})}cur.continue()};r.onerror=()=>res()});
    for(const k in out)out[k].sort((a,b)=>b.t-a.t);return out},
  add(scope,label,data,summary){const rec={key:scope+"|"+Date.now()+"|"+Math.random().toString(36).slice(2,6),scope,t:Date.now(),label,summary:summary||"",data};
    if(!this.ready){this.q.push(()=>this._put(rec));const {data:_,...meta}=rec;return meta}
    this._put(rec);const {data:_,...meta}=rec;return meta},
  _put(rec){const scope=rec.scope;
    if(!this.ok){const l=this.mem[scope]||(this.mem[scope]=[]);l.unshift(rec);if(l.length>3)l.length=3;idle(()=>lsSet(this.fbKey,this.mem));}
    else idle(()=>{try{this._tx("readwrite").put(rec)}catch(e){}})},
  async get(key){if(!this.ok){for(const sc in this.mem){const r=this.mem[sc].find(x=>x.key===key);if(r)return r}return null}
    return new Promise(res=>{const r=this._tx("readonly").get(key);r.onsuccess=()=>res(r.result||null);r.onerror=()=>res(null)})},
  del(keys){if(!keys.length)return;if(!this.ready){this.q.push(()=>this.del(keys));return}if(!this.ok){for(const sc in this.mem)this.mem[sc]=this.mem[sc].filter(x=>!keys.includes(x.key));idle(()=>lsSet(this.fbKey,this.mem));return}
    idle(()=>{try{const os=this._tx("readwrite");keys.forEach(k=>os.delete(k))}catch(e){}})},
};

/* backup files, written by the desktop app a few seconds after each change */
function deskBackupScheduler(kind,getText){let t=null,pending=false;
  const run=()=>{if(!pending)return;pending=false;clearTimeout(t);try{Desk.backup(typeof kind==="function"?kind():kind,getText())}catch(e){}};
  window.addEventListener("beforeunload",run);document.addEventListener("visibilitychange",()=>{if(document.hidden)run()});
  return ()=>{if(!Desk||!Desk.backup)return;pending=true;clearTimeout(t);t=setTimeout(()=>idle(run),4000)}}
function backupKindSafe(s){return slugify(s,40)||"x"}
function desktopBackupHTML(){
  if(!Desk)return `<p class="faint" style="margin:0;font-size:13px">Backup files are written automatically in the desktop app. Here, download a backup after each session.</p>`;
  return `<div style="display:grid;gap:6px"><span><span class="chip green">Automatic</span> Backup files are written to your <b>${IS_MAC?"Documents/Monolith/backups":"Documents\\Monolith\\backups"}</b> folder a few seconds after each change. One file per day is kept for 30 days.</span>
  <div class="row"><button class="btn sm" data-act="open-backups">Open backups folder</button></div></div>`}
