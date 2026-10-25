/* ============================== MONOLITH PLAYER: CHARACTERS ==============================
   The player's characters for this game, with autosave, version history, recently deleted and
   backup files. What a character is, and how it's built and shown, belongs to the game:
   rules.character (blank, normalize, card, label, summary) and rules.player.views. */
function rosterKey(k){return `monolith-roster-${GAME_INFO.id}${k?"-"+k:""}`}
const S={chars:new Map(),vmeta:{},trash:[],lastSaved:0,lastDownload:0,changed:false,saveTimer:null};
Object.assign(ui,{view:"roster",charId:null,histChar:null});
function sample(){return RS.character.sample||null}
function curChar(){const sm=sample();if(sm&&ui.charId===sm.id)return sm;return S.chars.get(ui.charId)||null}
function canEditChar(c){const sm=sample();return !!c&&!(sm&&c.id===sm.id)}
function allChars(){return [...S.chars.values()]}
function charLabel(c){try{return (RS.character.label?RS.character.label(c):c.name)||"Unnamed"}catch(e){return "Unnamed"}}
function rulesetId(){for(const [k,v] of Object.entries(GAME.rulesets))if(v===RS)return k;return Object.keys(GAME.rulesets)[0]}
function loadStore(){
  const list=LS.get(rosterKey(),[])||[];S.chars.clear();
  list.forEach(x=>{try{if(!RS.character.isCharacter(x))return;const c=RS.character.normalize(x);S.chars.set(c.id,c)}catch(e){}});
  S.trash=LS.get(rosterKey("trash"),[])||[];const m=LS.get(rosterKey("meta"),{})||{};S.lastSaved=m.savedAt||0;S.lastDownload=m.lastDownload||0;S.changed=!!m.changed}
function saveMeta(){LS.set(rosterKey("meta"),{savedAt:S.lastSaved,lastDownload:S.lastDownload,changed:S.changed})}
function persist(){
  clearTimeout(S.saveTimer);S.saveTimer=null;statusSaving=false;
  if(!lsSet(rosterKey(),allChars())){setStatusText("Storage full: download a backup","warn");showNotice("Storage is full. Download a backup, then clear version history in Backups.");return}
  S.lastSaved=Date.now();S.changed=true;saveMeta();updateStatus();pDeskBackup();
}
let statusSaving=false;
function stampChar(c){c.game=GAME_INFO.id;if(!c.ruleset)c.ruleset=rulesetId();c.gameVersion=GAME_INFO.version}
function saveChar(c,immediate){
  if(!c||!canEditChar(c))return;
  try{if(RS.character.beforeSave)RS.character.beforeSave(c)}catch(e){console.error(e)}
  stampChar(c);c.updatedAt=Date.now();S.chars.set(c.id,c);snapshot(c);
  if(!statusSaving){statusSaving=true;setStatusText("Saving…","live")}
  clearTimeout(S.saveTimer);
  if(immediate)persist();else S.saveTimer=setTimeout(()=>idle(persist),600);
  if(typeof netCharChanged==="function")netCharChanged(c);
}
function vsummary(d0){try{return RS.character.summary?RS.character.summary(d0):""}catch(e){return ""}}
// A new version is stored at most every 4 minutes per character (or on demand).
function snapshot(c,label,force){
  const list=S.vmeta[c.id]||(S.vmeta[c.id]=[]);const last=list[0];
  if(!force&&last&&Date.now()-last.t<4*60*1000)return;
  list.unshift(Versions.add(`char:${GAME_INFO.id}:${c.id}`,label||"Autosave",clone(c),vsummary(c)));
  if(list.length>20)Versions.del(list.splice(20).map(m=>m.key));
}
function addChar(c){stampChar(c);S.chars.set(c.id,c);snapshot(c,"Created",true);saveChar(c,true)}
function deleteChar(id){const c=S.chars.get(id);if(!c)return;S.trash.unshift({t:Date.now(),data:clone(c)});S.trash=S.trash.slice(0,20);lsSet(rosterKey("trash"),S.trash);S.chars.delete(id);persist()}
function updateStatus(){setStatusText(S.lastSaved?`Autosaved ${fmtTime(S.lastSaved)}`:"Autosave on","live")}
function markDownloaded(){S.lastDownload=Date.now();S.changed=false;saveMeta()}
function rosterFileText(chars){return JSON.stringify({format:"monolith-roster",version:1,game:GAME_INFO.id,gameVersion:GAME_INFO.version,app:"Monolith",savedAt:new Date().toISOString(),characters:chars},null,1)}
function charFileText(c){return JSON.stringify({format:"monolith-character",version:1,game:GAME_INFO.id,ruleset:c.ruleset||rulesetId(),gameVersion:GAME_INFO.version,exportedAt:new Date().toISOString(),character:c},null,1)}
function charFileName(c,t){return `${safeName(charLabel(c))}_${stamp(t)}.${GAME_INFO.id}.json`}
function downloadAll(){if(downloadText(`${GAME_INFO.id}-characters_${stamp()}.json`,rosterFileText(allChars()))){markDownloaded();showNotice(`Downloaded a backup of ${S.chars.size} character${S.chars.size===1?"":"s"}.`);requestRender()}}
function downloadChar(c){const copy=clone(c);const sm=sample();if(sm&&copy.id===sm.id)copy.id=uid();downloadText(charFileName(c),charFileText(copy))}
function parseCharFile(text){let data;try{data=JSON.parse(text)}catch(e){return {error:"not valid JSON"}}
  const out={chars:[],otherGame:""};if(!data||typeof data!=="object")return {error:"empty"};
  if(data.game&&data.game!==GAME_INFO.id){out.otherGame=String(data.game).slice(0,40);return out}
  const ok=x=>{try{return RS.character.isCharacter(x)}catch(e){return false}};
  if(data.format==="monolith-character"&&ok(data.character))out.chars.push(data.character);
  else if(data.format==="monolith-roster"&&Array.isArray(data.characters))data.characters.forEach(x=>{if(ok(x))out.chars.push(x)});
  return out}
function importFiles(files){
  readFiles(files).then(list=>{
    let added=0,replaced=0,bad=0,other="";
    list.forEach(f=>{const r=parseCharFile(f.text);if(r.otherGame){other=r.otherGame;bad++;return}if(r.error||!r.chars.length){bad++;return}
      r.chars.forEach(x=>{const c=RS.character.normalize(x);const sm=sample();if(sm&&c.id===sm.id)c.id=uid();const ex=S.chars.get(c.id);
        if(ex){snapshot(ex,"Before restore from file",true);replaced++}else added++;
        stampChar(c);S.chars.set(c.id,c);snapshot(c,"Loaded from file",true)})});
    persist();render();
    const parts=[];if(added)parts.push(`${added} added`);if(replaced)parts.push(`${replaced} updated (old versions kept in history)`);
    showNotice(parts.length?`Restored: ${parts.join(", ")}.`+(bad?` ${bad} file${bad>1?"s":""} skipped.`:""):other?`That file is for another game (${other}). Open it from that game in Monolith.`:"No characters found in that file.");
  });
}
window.addEventListener("beforeunload",()=>{if(S.saveTimer)persist()});
document.addEventListener("visibilitychange",()=>{if(document.hidden&&S.saveTimer)persist()});
setInterval(()=>{if(S.lastSaved)updateStatus()},30000);
const pDeskBackup=deskBackupScheduler(()=>`${GAME_INFO.id}-characters`,()=>rosterFileText(allChars()));
function whoName(){const c=curChar()||(typeof myChar==="function"?myChar():null);return c?charLabel(c):"Player"}

/* ============================== RENDER ============================== */
function render(){
  if(rq){cancelAnimationFrame(rq);rq=0}if(!GAME)return;
  runBeforeRender();
  const c=curChar();const views=(RS.player&&RS.player.views)||{};
  if(ui.view!=="roster"&&ui.view!=="table"&&(!c||!views[ui.view])){ui.view="roster";ui.charId=null}
  renderNav();
  patch(app,ui.view==="table"?viewTable():ui.view==="roster"?viewRoster():views[ui.view](c));
  renderModal();afterRender();
}
function renderNav(){
  const c=curChar();const nav=document.getElementById("nav");const noun=(RS.player&&RS.player.charNoun)||["character","characters"];
  let h=`<button class="${ui.view==="roster"?"on":""}" data-act="go-roster">${esc(noun[1][0].toUpperCase()+noun[1].slice(1))}</button>`;
  if(c&&ui.view!=="roster"&&ui.view!=="table") h+=`<button class="on">${esc(charLabel(c))}</button>`;
  h+=`${tableNavBtn()}${RS.player&&RS.player.navExtra?RS.player.navExtra():""}<button data-act="open-modal" data-m="backups">Backups</button>`;
  patch(nav,h);
}

/* ---------- roster ---------- */
function viewRoster(){
  const chars=allChars().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));const sm=sample();const noun=(RS.player&&RS.player.charNoun)||["character","characters"];
  const nudge=S.chars.size>0&&S.changed&&!Desk&&(Date.now()-(S.lastDownload||0)>3*24*3600*1000)?`<div class="banner warnb" style="margin-bottom:16px"><b>${S.lastDownload?"Your last backup file is "+ago(S.lastDownload)+".":"You haven't saved a backup file yet."}</b> <button class="btn sm primary" data-act="download-all">Download backup</button></div>`:"";
  const nw=RS.player&&RS.player.newCard?RS.player.newCard():{label:"New",title:`+ New ${noun[0]}`,text:""};
  return `
  <div class="roster-head">
    <h1><small>${esc(GAME_INFO.name)}${RS.name&&RS.name!==GAME_INFO.name?" · "+esc(RS.name):""}</small>${esc((RS.player&&RS.player.rosterTitle)||"Your "+noun[1])}</h1>
    <div class="row"><button class="btn" data-act="pick-file">Load from file</button><button class="btn primary" data-act="new-character">+ New ${esc(noun[0])}</button></div>
  </div>
  ${nudge}
  <div class="roster-layout">
    <section style="min-width:0">
      <div class="cards">
        ${chars.map(rosterCard).join("")}
        <button class="card new" data-act="new-character"><span class="label">${esc(nw.label||"")}</span><h3>${esc(nw.title)}</h3><span class="muted" style="font-size:13.5px">${esc(nw.text||"")}</span></button>
        ${sm?rosterCard(sm):""}
      </div>
      ${!chars.length?`<p class="faint" style="margin-top:14px;font-size:13.5px">Have a backup or a ${esc(noun[0])} file from your GM? Drop the .json file anywhere on this page, or use Load from file.</p>`:""}
    </section>
    ${backupPanel()}
  </div>`;
}
function rosterCard(c){
  const k=RS.character.card(c);const sm=sample();const isS=!!(sm&&c.id===sm.id);
  return `<article class="card">
    <div class="card-top">
      <div class="portrait" style="background:${esc(k.color||"#2a2a2a")}">${esc(k.initial||"?")}</div>
      <div class="who">
        <div class="row" style="gap:6px">${isS?`<span class="chip amber">Example</span>`:""}${(k.chips||[]).map(x=>`<span class="chip ${esc(x.c||"ink")}">${esc(x.t)}</span>`).join("")}</div>
        <h3>${esc(k.name)}</h3>
        <div class="sub">${esc(k.sub||"")}${!isS?` · saved ${ago(c.updatedAt)}`:""}</div>
      </div>
    </div>
    ${(k.stats||[]).length?`<div class="card-stats">${k.stats.map(([l,v])=>`<div><span class="label">${esc(l)}</span><b class="num">${esc(v)}</b></div>`).join("")}</div>`:""}
    ${k.meter?`<div class="meter" title="${esc(k.meter.title||"")}"><i style="width:${clamp(Number(k.meter.frac)||0,0,1)*100}%"></i></div>`:""}
    <div class="card-foot">
      <button class="btn sm ${k.draft?"primary":""}" data-act="open-char" data-id="${esc(c.id)}">${esc(k.openLabel||"Open")}</button>
      ${isS?`<button class="btn sm ghost" data-act="copy-sample">Copy to my ${esc(((RS.player&&RS.player.charNoun)||["characters"])[1]||"characters")}</button>`:`${k.actions||""}<button class="btn sm ghost" data-act="ask-delete" data-id="${esc(c.id)}" aria-label="Delete ${esc(k.name)}">Delete</button>`}
      ${k.corner?`<span class="faint mono" style="margin-left:auto;font-size:12px">${esc(k.corner)}</span>`:""}
    </div>
  </article>`;
}
function backupPanel(){
  const hist=Object.values(S.vmeta).reduce((a,h)=>a+h.length,0);
  return `<aside class="panel">
    <div class="panel-h"><h3>Autosave & backups</h3><span class="chip green">Autosave on</span></div>
    <div class="panel-b" style="display:grid;gap:14px">
      <div><span class="label">Last autosave</span><div class="mono" style="font-size:15px;font-weight:600">${S.lastSaved?fmtTime(S.lastSaved):"Nothing to save yet"}</div>
        <p class="faint" style="margin:4px 0 0;font-size:12.5px">Every change saves as you make it. ${hist} earlier version${hist===1?" is":"s are"} kept so you can roll back.</p></div>
      <div style="display:grid;gap:6px"><span class="label">Backup files</span>${desktopBackupHTML()}</div>
      <div style="display:grid;gap:6px"><span class="label">Manual backup</span>
        <div class="row"><button class="btn" data-act="download-all" ${S.chars.size?"":"disabled"}>Download backup</button><button class="btn ghost" data-act="pick-file">Restore from file</button></div>
        <span class="faint" style="font-size:12.5px">Last downloaded: ${S.lastDownload?ago(S.lastDownload):"never"}.</span></div>
      <hr class="sep" style="margin:0">
      <div class="row"><button class="btn sm" data-act="open-modal" data-m="backups">Version history & recently deleted</button>${RS.player&&RS.player.backupExtra?RS.player.backupExtra():""}</div>
    </div>
  </aside>`;
}
function backupsBody(){
  const chars=allChars().sort((a,b)=>charLabel(a).localeCompare(charLabel(b)));
  const cc=curChar();const sel=ui.histChar&&S.chars.has(ui.histChar)?ui.histChar:(cc&&canEditChar(cc)?cc.id:(chars[0]?.id||null));
  const hist=sel?(S.vmeta[sel]||[]):[];const cur=sel?S.chars.get(sel):null;
  return `<div style="display:grid;gap:18px">
    <section style="display:grid;gap:8px"><h3 class="mh">Back up everything</h3>
      <div class="row"><button class="btn primary" data-act="download-all" ${S.chars.size?"":"disabled"}>Download full backup (.json)</button><button class="btn" data-act="pick-file">Restore from a backup file…</button></div>
      <span class="faint" style="font-size:12.5px">A backup holds every character for ${esc(GAME_INFO.name)}. Restoring replaces characters with the same ID (their current version goes into history first) and adds any new ones. You can also drop files onto the page.</span>
      <div style="display:grid;gap:6px;padding:10px;border:1px dashed var(--line)"><span class="label">Backup files</span>${desktopBackupHTML()}</div>
    </section>
    <section style="display:grid;gap:8px"><div class="row" style="justify-content:space-between"><h3 class="mh">Version history</h3>
      ${chars.length?`<select data-act-change="hist-char" aria-label="Character">${chars.map(c=>`<option value="${esc(c.id)}" ${c.id===sel?"selected":""}>${esc(charLabel(c))}</option>`).join("")}</select>`:""}</div>
      ${cur?`<div class="row" style="justify-content:space-between"><span class="faint" style="font-size:12.5px">A version is kept every few minutes while you play, plus before any restore. Up to 20 per character.</span><button class="btn sm" data-act="snap-now" data-id="${esc(cur.id)}">Save a version now</button></div>
      <div class="items">${hist.length?hist.map((h,i)=>`<div class="it"><div style="min-width:0"><div class="t">${fmtTime(h.t)} <span class="chip ink">${esc(h.label)}</span></div><div class="m">${esc(h.summary||"")}</div></div>
        <div class="a"><button class="btn sm" data-act="hist-restore" data-id="${esc(cur.id)}" data-i="${i}">Restore</button><button class="btn sm ghost" data-act="hist-download" data-id="${esc(cur.id)}" data-i="${i}">Download</button></div></div>`).join(""):`<p class="faint" style="margin:0">No versions yet. They appear as you edit.</p>`}</div>`:`<p class="faint" style="margin:0">No characters yet.</p>`}
    </section>
    <section style="display:grid;gap:8px"><h3 class="mh">Recently deleted</h3>
      <div class="items">${S.trash.length?S.trash.map((t,i)=>{let k;try{k=RS.character.card(RS.character.normalize(t.data))}catch(e){k={name:"Unnamed",sub:""}}return `<div class="it"><div style="min-width:0"><div class="t">${esc(k.name)} <span class="faint" style="font-weight:400">${esc(k.sub||"")}</span></div><div class="m">Deleted ${fmtTime(t.t)}</div></div>
        <div class="a"><button class="btn sm" data-act="trash-restore" data-i="${i}">Restore</button><button class="btn sm ghost" data-act="trash-forget" data-i="${i}">${ui.confirm==="trash-"+i?"Confirm":"Forget"}</button></div></div>`}).join(""):`<p class="faint" style="margin:0">Nothing deleted.</p>`}</div>
    </section>
    <section class="row" style="justify-content:space-between"><span class="faint" style="font-size:12.5px">Storage used: ${fmtKB(lsSize(rosterKey()))}</span><button class="btn sm danger" data-act="clear-history">${ui.confirm==="clear-hist"?"Yes, clear all version history":"Clear version history"}</button></section>
  </div>`;
}
function deleteNeedle(c){const n=String(charLabel(c)).trim();return n&&n!=="Unnamed"?n:"DELETE"}
function deleteBody(c){
  const k=RS.character.card(c);const need=deleteNeedle(c);const atTable=typeof Net!=="undefined"&&Net.charId===c.id&&Net.state!=="off";
  return `<div style="display:grid;gap:14px">
    <div class="delcard"><div class="portrait" style="background:${esc(k.color||"#2a2a2a")}">${esc(k.initial||"?")}</div>
      <div style="min-width:0"><b class="delname">${esc(k.name)}</b><div class="muted" style="font-size:14px">${esc(k.sub||"")}</div></div></div>
    <p style="margin:0">This removes ${esc(k.name)} from your list. It goes to <b>Backups → Recently deleted</b> (the 20 most recent are kept), so you can still bring it back from there.${atTable?" <b>You're at a table with this character, so deleting it also takes you off the table.</b>":""}</p>
    ${confirmField("del-confirm",need,"del-go")}
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="close-modal">Keep it</button><button class="btn danger" id="del-go" data-act="do-delete" disabled>Delete</button></div>
  </div>`}
Object.assign(MODALS,{
  backups:()=>({title:"Backups & version history",body:backupsBody()}),
  delete:()=>{const c=S.chars.get(ui.delId);if(!c)return null;return {title:`Delete ${charLabel(c)}?`,body:deleteBody(c)}},
});

/* ---------- actions ---------- */
function openCharacter(c){ui.charId=c.id;ui.view=(RS.player&&RS.player.openView?RS.player.openView(c):"sheet");if(RS.player&&RS.player.onOpen)RS.player.onOpen(c);render();window.scrollTo(0,0)}
Object.assign(A,{
  "go-roster":()=>{ui.view="roster";ui.charId=null;ui.modal=null;render();window.scrollTo(0,0)},
  "new-character":()=>{if(MODALS.newchar){ui.modal="newchar";renderModal();return}const c=RS.character.blank();addChar(c);openCharacter(c)},
  "open-char":el=>{const id=el.dataset.id;const sm=sample();const c=sm&&id===sm.id?sm:S.chars.get(id);if(c)openCharacter(c)},
  "copy-sample":()=>{const sm=sample();if(!sm)return;const c=RS.character.copy?RS.character.copy(sm):clone(sm);c.id=uid();c.createdAt=Date.now();addChar(c);openCharacter(c);showNotice(`Copied. ${charLabel(c)} is yours to edit.`)},
  "ask-delete":el=>{const id=el.dataset.id||(curChar()&&curChar().id);if(!id||!S.chars.has(id))return;ui.delId=id;ui.modal="delete";renderModal();setTimeout(()=>document.getElementById("del-confirm")?.focus(),40)},
  "do-delete":()=>{const c=S.chars.get(ui.delId);const inp=document.getElementById("del-confirm");if(!c||!inp)return;
    if(inp.value.trim().toLowerCase()!==deleteNeedle(c).toLowerCase()){showNotice("The name you typed doesn't match.");return}
    if(typeof Net!=="undefined"&&Net.charId===c.id&&Net.state!=="off")netLeave();
    const name=charLabel(c);deleteChar(c.id);ui.modal=null;ui.delId=null;if(ui.charId===c.id){ui.charId=null;ui.view="roster"}render();window.scrollTo(0,0);showNotice(`${name} deleted. Restore it from Backups → Recently deleted if you change your mind.`)},
  "download-all":()=>downloadAll(),
  "download-char":el=>{const id=el&&el.dataset&&el.dataset.id;const c=id?S.chars.get(id):curChar();if(c)downloadChar(c)},
  "snap-now":el=>{const c=S.chars.get(el.dataset.id);if(!c)return;snapshot(c,"Saved by hand",true);renderModal();showNotice("Version saved.")},
  "hist-restore":async el=>{const c=S.chars.get(el.dataset.id);const m=(S.vmeta[el.dataset.id]||[])[Number(el.dataset.i)];if(!c||!m)return;const h=await Versions.get(m.key);if(!h){showNotice("That version couldn't be read.");return}
    snapshot(c,"Before restore",true);const r=RS.character.normalize(h.data);r.id=c.id;r.updatedAt=Date.now();stampChar(r);S.chars.set(c.id,r);persist();ui.modal=null;render();showNotice(`Restored ${charLabel(r)} to ${fmtTime(m.t)}.`)},
  "hist-download":async el=>{const m=(S.vmeta[el.dataset.id]||[])[Number(el.dataset.i)];if(!m)return;const h=await Versions.get(m.key);if(h)downloadText(charFileName(h.data,m.t),charFileText(h.data))},
  "trash-restore":el=>{const i=Number(el.dataset.i);const t=S.trash[i];if(!t)return;const c=RS.character.normalize(t.data);if(S.chars.has(c.id))c.id=uid();S.trash.splice(i,1);lsSet(rosterKey("trash"),S.trash);addChar(c);renderModal();render();showNotice(`${charLabel(c)} is back on your list.`)},
  "trash-forget":el=>{const i=Number(el.dataset.i);if(ui.confirm!=="trash-"+i){ui.confirm="trash-"+i;renderModal();return}S.trash.splice(i,1);lsSet(rosterKey("trash"),S.trash);ui.confirm=null;renderModal()},
  "clear-history":()=>{if(ui.confirm!=="clear-hist"){ui.confirm="clear-hist";renderModal();return}Versions.del(Object.values(S.vmeta).flat().map(m=>m.key));S.vmeta={};ui.confirm=null;renderModal();showNotice("Version history cleared.")},
});
Object.assign(CHANGE,{"hist-char":el=>{ui.histChar=el.value;renderModal()}});
