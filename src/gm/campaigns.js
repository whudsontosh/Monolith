/* ============================== MONOLITH GM: CAMPAIGNS ==============================
   The GM can keep several campaigns per game. Each has its own party, maps, notes, session log,
   table log, room password, version history and backup files, plus whatever the game keeps.
   One is open at a time and the table always serves the open one. Switching saves, closes the
   table if it's open, and reloads the console on the chosen campaign. */
function campTrashScope(){return "camp-trash:"+gameId()}
function campEntry(id){return campsLoad().list.find(c=>c.id===id)||null}
function campStateOf(id){if(id===CUR)return st;const s=LS.get(campKey(id,"state"),null);const out=fullState(s&&typeof s==="object"?s:{});if(!s){const e=campEntry(id);if(e)out.campaign.name=e.name}return out}
function campBackupTextOf(id){return campaignFileText(campStateOf(id))}
function campNewId(){return campNewIdIn(campsAll())}
function campUniqueName(name){const names=new Set(campsLoad().list.map(c=>(c.name||"").toLowerCase()));let n=cleanText(name,80)||"New campaign";if(!names.has(n.toLowerCase()))return n;
  for(let i=2;i<99;i++){const t=`${n} (${i})`;if(!names.has(t.toLowerCase()))return t}return n}
/* create from scratch (data null) or from a backup / copy; returns the new id, or null */
function campCreate(name,data,opts={}){const id=campNewId();const s=data?fullState(clone(data)):defaultState();
  s.campaign.name=campUniqueName(name);
  if(!data||opts.freshPassword||!s.host.password)s.host.password=newPassword();
  if(opts.clearLog)s.tableLog=[];
  if(opts.apply)opts.apply(s);
  if(!lsSet(campKey(id,"state"),s)){showNotice("Browser storage is full, so the campaign couldn't be created. Download backups, then delete old campaigns or clear version history.");return null}
  const x=campsLoad();const now=Date.now();x.all.list.push({id,game:gameId(),ruleset:rulesetId(),gameVersion:GAME_INFO.version,name:s.campaign.name,created:now,updated:now,summary:gmSummary(s),crew:campCrew(s)});
  if(!campsSave(x)){try{localStorage.removeItem(campKey(id,"state"))}catch(e){}showNotice("Browser storage is full, so the campaign couldn't be created.");return null}
  return id}
function campDuplicate(id){if(id===CUR)persist();const s=campStateOf(id);const nid=campCreate((s.campaign.name||"Campaign")+" (copy)",s,{freshPassword:true,clearLog:true});
  if(nid){showNotice(`Copied "${s.campaign.name}". The copy has its own room password.`);requestRender()}}
function campRename(id,name){name=cleanText(name,80);if(!name)return false;
  if(id===CUR){st.campaign.name=name;persist();render();return true}
  const s=LS.get(campKey(id,"state"),null);if(s&&typeof s==="object"){s.campaign={...(s.campaign||{}),name};if(!lsSet(campKey(id,"state"),s)){showNotice("Couldn't save the new name: browser storage is full.");return false}}
  const x=campsLoad();const e=x.list.find(c=>c.id===id);if(e){e.name=name;campsSave(x)}return true}
function campDownload(id){if(id===CUR)persist();const e=campEntry(id);const name=campSlug(e&&e.name)||"campaign";
  if(downloadText(`${gameId()}-campaign-${name}_${stamp()}.json`,id===CUR?gmBackupText():campBackupTextOf(id))){if(id===CUR)markDownloaded();showNotice("Campaign backup downloaded.")}}

/* ---------- switching ---------- */
function hosting(){return Host.status==="online"||Host.status==="starting"}
function campSwitch(id,after){const e=campEntry(id);if(!e)return;
  if(id===CUR){ui.tab="party";ui.open=null;if(after==="host")campAutoHost(true);render();window.scrollTo(0,0);return}
  if(hosting()){ui.campNext={id,after:after||"open"};ui.modal="camp-switch";renderModal();return}
  campDoSwitch(id,after)}
async function campDoSwitch(id,after){const e=campEntry(id);if(!e)return;
  ui.modal=null;renderModal();
  persist();
  if(hosting())await hostStop().catch(()=>{});
  const x=campsLoad();x.all.current[gameId()]=id;if(!campsSave(x)){showNotice("Couldn't switch: browser storage is full.");return}
  ssSet("monolith-gm-after",after==="host"?"host":"open");
  document.body.insertAdjacentHTML("beforeend",`<div class="camp-switching" role="status"><div><span class="label">Opening campaign</span><b>${esc(e.name)}</b></div></div>`);
  // give pending version-history and backup-file writes a moment to land before reloading
  setTimeout(()=>location.reload(),650)}
/* runs once the table server is ready after boot */
function campAfterBoot(){if(ui.autoHost){ui.autoHost=false;campAutoHost(false)}}
function campAutoHost(now){if(!Desk){ui.modal="host";renderModal();return}
  if(hosting()){ui.modal="host";renderModal();return}
  const last=Settings.get("hostLast",null)||{};const m=last.mode;ui.modal="host";renderModal();
  if(m==="online")hostOnline();
  else if(m==="direct"){Host.directPort=clamp(Number(last.port)||Host.directPort,1024,65535);hostDirect()}
  else if(m==="local")hostLocal()}
function hostCampLine(){const n=campsLoad().list.length;
  return `<div class="campline"><span class="label">Hosting campaign</span><b>${esc(st.campaign.name||"Untitled")}</b>${n>1?`<button class="btn sm ghost" data-act="tab" data-t="campaigns">Switch campaign</button>`:""}</div>`}

/* ---------- deleting (kept in "Recently deleted") ---------- */
async function campLoadTrash(){if(!Versions.ready)await new Promise(r=>Versions.q.push(r));
  const T=campTrashScope();const all=await Versions.listAll(T).catch(()=>({}));ui.campTrash=(all[T]||[]).slice(0,8);requestRender()}
async function campDelete(id){const e=campEntry(id);if(!e||id===CUR)return;
  const s=campStateOf(id);
  Versions.add(campTrashScope(),e.name||"Campaign",clone(s),gmSummary(s));
  ["state","meta","rolls"].forEach(k=>LS.del(campKey(id,k)));
  const x=campsLoad();x.all.list=x.all.list.filter(c=>c.id!==id);campsSave(x);
  ui.modal=null;ui.campDelId=null;ui.campDelTyped="";renderModal();
  showNotice(`Deleted "${e.name}". You can bring it back from Recently deleted.`);
  try{const sc=campScope(id);const all=await Versions.listAll(sc);Versions.del((all[sc]||[]).map(m=>m.key))}catch(_){}
  setTimeout(async()=>{try{const T=campTrashScope();const all=await Versions.listAll(T);const l=all[T]||[];if(l.length>8)Versions.del(l.slice(8).map(m=>m.key))}catch(_){}campLoadTrash()},300)}
async function campRestoreTrash(key){const h=await Versions.get(key);if(!h||!h.data){showNotice("That campaign couldn't be read.");return}
  const id=campCreate(h.data.campaign&&h.data.campaign.name||h.label||"Restored campaign",h.data);
  if(id){Versions.del([key]);ui.campTrash=(ui.campTrash||[]).filter(m=>m.key!==key);showNotice(`Restored "${campEntry(id).name}".`);requestRender()}}
function campDelNeedle(e){const n=String(e&&e.name||"").trim();return n.length>=3&&n.length<=40?n:"DELETE"}

/* ---------- view ---------- */
function viewCampaigns(){const x=campsLoad();
  if(ui.campTrash===undefined){ui.campTrash=[];campLoadTrash()}
  const list=x.list.slice().sort((a,b)=>(b.id===CUR)-(a.id===CUR)||(b.updated||0)-(a.updated||0));
  const desk=!!Desk;
  const card=c=>{const open=c.id===CUR;const live=open&&Host.status==="online";const crew=(open?campCrew(st):c.crew)||[];const summary=open?gmSummary(st):c.summary;const name=open?st.campaign.name:c.name;
    const renaming=ui.campRename===c.id;
    return `<article class="camp-card${open?" is-open":""}" data-camp="${esc(c.id)}">
      <div class="camp-top"><span class="label">${open?"Open now":c.updated?"Last saved "+ago(c.updated):"Never opened"}</span>${live?`<span class="chip green">Hosting · ${Host.conns.size} player${Host.conns.size===1?"":"s"}</span>`:open&&Host.status==="starting"?`<span class="chip amber">Going online…</span>`:""}</div>
      ${renaming?`<div class="row" style="flex-wrap:nowrap"><input id="camp-rename-in" data-id="${esc(c.id)}" value="${esc(name||"")}" maxlength="80" aria-label="Campaign name"><button class="btn sm primary" data-act="camp-rename-save" data-id="${esc(c.id)}">Save</button><button class="btn sm ghost" data-act="camp-rename-cancel">Cancel</button></div>`
        :`<h2 class="camp-name">${esc(name||"Untitled")}</h2>`}
      <div class="camp-crew">${crew.length?crew.map(h=>`<span class="chip">${esc(h)}</span>`).join(""):`<span class="faint">No runners yet</span>`}</div>
      <p class="faint camp-sum">${esc(summary||"")}</p>
      <div class="row camp-main">${open?`<button class="btn primary" data-act="tab" data-t="party">Back to the table</button>`:`<button class="btn primary" data-act="camp-open" data-id="${esc(c.id)}">Open</button>`}
        ${desk?`<button class="btn" data-act="camp-host" data-id="${esc(c.id)}">${live?"Table window":"Open & host"}</button>`:""}</div>
      <div class="row camp-tools"><button class="btn sm ghost" data-act="camp-rename" data-id="${esc(c.id)}">Rename</button><button class="btn sm ghost" data-act="camp-dup" data-id="${esc(c.id)}">Duplicate</button><button class="btn sm ghost" data-act="camp-dl" data-id="${esc(c.id)}">Download</button>${open?"":`<button class="btn sm ghost danger" data-act="camp-ask-del" data-id="${esc(c.id)}">Delete</button>`}</div>
    </article>`};
  const trash=ui.campTrash||[];
  return `<div class="roster-head"><h1><small>${esc(GAME_INFO.name)} · ${x.list.length} campaign${x.list.length===1?"":"s"}</small>Campaigns</h1>
    <div class="row"><button class="btn" data-act="camp-import">Import a campaign file</button>${RS.gm&&RS.gm.campaignsActions?RS.gm.campaignsActions():""}</div></div>
  <p class="muted" style="margin:-6px 0 16px;max-width:76ch">Each campaign keeps its own party, maps, notes and session log, plus its own room password, version history and backup files. One campaign is open at a time, and hosting always serves the open one.</p>
  <div class="camp-grid">${list.map(card).join("")}
    <article class="camp-card camp-new"><div class="camp-top"><span class="label">New campaign</span></div>
      <div class="field"><label class="label" for="camp-new-name">Name</label><input id="camp-new-name" maxlength="80" placeholder="e.g. The Arasaka Job" value="${esc(ui.campNewName||"")}"></div>
      ${RS.campaign&&RS.campaign.newOptions?RS.campaign.newOptions():""}
      <div class="row camp-main"><button class="btn primary" data-act="camp-create">Create & open</button></div>
      <span class="faint" style="font-size:12.5px">Starts with an empty party and no maps. Players join it with its own invite code.</span>
    </article>
  </div>
  ${trash.length?`<section class="panel" style="margin-top:22px"><div class="panel-h"><h3>Recently deleted</h3><span class="faint mono" style="font-size:12px">the 8 most recent are kept</span></div><div class="panel-b"><div class="items">${trash.map(m=>`<div class="it"><div style="min-width:0"><div class="t">${esc(m.label)}</div><div class="m">Deleted ${fmtTime(m.t)} · ${esc(m.summary||"")}</div></div><div class="a"><button class="btn sm" data-act="camp-undelete" data-k="${esc(m.key)}">Restore</button></div></div>`).join("")}</div></div></section>`:""}`}

/* ---------- modals ---------- */
function campModal(m){
  if(m==="camp-del"){const e=campEntry(ui.campDelId);if(!e||e.id===CUR)return null;const need=campDelNeedle(e);const ok=(ui.campDelTyped||"").trim().toLowerCase()===need.toLowerCase();
    return {title:`Delete "${e.name}"?`,body:`<div style="display:grid;gap:14px">
      <div class="delcard"><div class="portrait" style="background:#3d4352">${esc((e.name||"?").charAt(0).toUpperCase())}</div><div style="min-width:0"><b class="delname">${esc(e.name)}</b><div class="muted" style="font-size:14px">${esc(e.summary||"")}${e.updated?" · last saved "+ago(e.updated):""}</div></div></div>
      <p style="margin:0">This removes the campaign and its version history from the console. A copy goes to <b>Recently deleted</b> on this screen (the 8 most recent are kept), and ${Desk?"the backup files already in your backups folder stay where they are":"any backup files you downloaded are untouched"}. Players' own characters aren't affected.</p>
      <div class="field"><label class="label" for="camp-del-in">To confirm, type <span class="mono" style="color:var(--ink);letter-spacing:.04em">${esc(need)}</span></label>
        <input id="camp-del-in" autocomplete="off" spellcheck="false" data-need="${esc(need.toLowerCase())}" placeholder="${esc(need)}" value="${esc(ui.campDelTyped||"")}"></div>
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="close-modal">Keep it</button><button class="btn danger" id="camp-del-go" data-act="camp-do-del" ${ok?"":"disabled"}>Delete campaign</button></div></div>`}}
  if(m==="camp-switch"){const n=ui.campNext&&campEntry(ui.campNext.id);if(!n)return null;const k=Host.conns.size;
    return {title:"Close the table and switch?",body:`<div style="display:grid;gap:14px">
      <p style="margin:0">You're hosting <b>${esc(st.campaign.name)}</b>${k?` with ${k} player${k===1?"":"s"} connected`:""}. Opening <b>${esc(n.name)}</b> closes this table first${k?" and disconnects everyone":""}. ${esc(st.campaign.name)} is saved as it is.</p>
      ${ui.campNext.after==="host"?`<p class="faint" style="margin:0">The new campaign goes online straight away${(Settings.get("hostLast",null)||{}).mode==="online"?" with a new invite code":""}. Players need its invite code and password to join.</p>`:""}
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="close-modal">Stay here</button><button class="btn primary" data-act="camp-switch-go">Close table & open ${esc(n.name)}</button></div></div>`}}
  if(m==="gm-import"){const l=ui.gmPending||[];if(!l.length)return null;const one=l.length===1;const nm=one?(l[0].data.campaign&&l[0].data.campaign.name)||l[0].name:"";
    return {title:one?"Campaign file":"Campaign files",body:`<div style="display:grid;gap:14px">
      <p style="margin:0">${one?`<b>${esc(nm)}</b> is a campaign backup.`:`These ${l.length} files are campaign backups.`} What should happen to ${one?"it":"them"}?</p>
      <div class="hostopt rec"><div><h3>Add as ${one?"a new campaign":"new campaigns"}</h3><p>${one?"It":"Each one"} joins your campaign list. Nothing open now changes.</p></div><button class="btn primary" data-act="gm-import-new">Add to my campaigns</button></div>
      ${one?`<div class="hostopt"><div><h3>Replace ${esc(st.campaign.name)}</h3><p>Overwrites the open campaign with this file. The current state goes into version history first, so you can undo it.</p></div><button class="btn danger" data-act="gm-import-replace">Replace</button></div>`:""}
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="gm-import-cancel">Cancel</button></div></div>`}}
  return null}

/* ---------- actions ---------- */
Object.assign(A,{
  "camp-open":el=>campSwitch(el.dataset.id,"open"),
  "camp-host":el=>campSwitch(el.dataset.id,"host"),
  "camp-switch-go":()=>{const n=ui.campNext;ui.campNext=null;if(n)campDoSwitch(n.id,n.after)},
  "camp-create":()=>{const inp=document.getElementById("camp-new-name");const name=cleanText(inp&&inp.value,80)||"New campaign";
    const id=campCreate(name,null,{apply:s=>{if(RS.campaign&&RS.campaign.applyNewOptions)RS.campaign.applyNewOptions(s)}});if(!id)return;
    ui.campNewName="";campSwitch(id,"open")},
  "camp-rename":el=>{ui.campRename=el.dataset.id;render();setTimeout(()=>{const i=document.getElementById("camp-rename-in");if(i){i.focus();i.select()}},30)},
  "camp-rename-cancel":()=>{ui.campRename=null;render()},
  "camp-rename-save":el=>{const i=document.getElementById("camp-rename-in");if(i&&campRename(el.dataset.id,i.value)){ui.campRename=null;render()}},
  "camp-dup":el=>campDuplicate(el.dataset.id),
  "camp-dl":el=>campDownload(el.dataset.id),
  "camp-ask-del":el=>{ui.campDelId=el.dataset.id;ui.campDelTyped="";ui.modal="camp-del";renderModal();setTimeout(()=>document.getElementById("camp-del-in")?.focus(),40)},
  "camp-do-del":()=>{const e=campEntry(ui.campDelId);if(!e)return;if((ui.campDelTyped||"").trim().toLowerCase()!==campDelNeedle(e).toLowerCase())return;campDelete(e.id)},
  "camp-undelete":el=>campRestoreTrash(el.dataset.k),
  "camp-import":()=>{ui.importAs="new";document.getElementById("file-in").click()},
  "gm-import-new":()=>{const l=ui.gmPending||[];ui.gmPending=null;ui.modal=null;renderModal();let n=0;
    l.forEach(g=>{if(campCreate((g.data.campaign&&g.data.campaign.name)||g.name.replace(/\.json$/i,""),g.data))n++});
    if(n){showNotice(`${n} campaign${n===1?"":"s"} added. Open ${n===1?"it":"them"} from Campaigns.`);ui.tab="campaigns";render()}},
  "gm-import-replace":()=>{const l=ui.gmPending||[];ui.gmPending=null;ui.modal=null;if(!l[0])return;restoreGm(l[0].data);ui.open=null;persist();render();showNotice("Backup restored into this campaign.")},
  "gm-import-cancel":()=>{ui.gmPending=null;ui.modal=null;renderModal()},
});
document.addEventListener("input",ev=>{const el=ev.target;
  if(el.id==="camp-del-in"){ui.campDelTyped=el.value;const b=document.getElementById("camp-del-go");if(b)b.disabled=el.value.trim().toLowerCase()!==el.dataset.need}
  else if(el.id==="camp-new-name")ui.campNewName=el.value});
document.addEventListener("keydown",ev=>{const t=ev.target;
  if(ev.key==="Escape"&&t.id==="camp-rename-in"){ui.campRename=null;render();return}
  if(ev.key!=="Enter")return;
  if(t.id==="camp-del-in"){ev.preventDefault();const b=document.getElementById("camp-del-go");if(b&&!b.disabled)A["camp-do-del"]()}
  else if(t.id==="camp-new-name"){ev.preventDefault();A["camp-create"]()}
  else if(t.id==="camp-rename-in"){ev.preventDefault();A["camp-rename-save"](t)}});

/* ---------- what to show on launch ---------- */
function campLaunchView(){const after=ssGet("monolith-gm-after");ssSet("monolith-gm-after",null);
  if(after==="host")ui.autoHost=true;
  else if(!after&&!ssGet("monolith-gm-picked-"+gameId())&&campsLoad().list.length>1)ui.tab="campaigns";
  ssSet("monolith-gm-picked-"+gameId(),"1")}
