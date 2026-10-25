/* ============================== MONOLITH GM: CAMPAIGN STATE ==============================
   Every campaign records its game, ruleset and the game version it was last saved with.
   The core owns the campaign's frame (name, notes, sessions, party, players, maps, table, host
   settings); the game adds its own fields through rules.campaign.defaults(). One campaign is
   open at a time; the GM window only lists campaigns for the game it's playing. */
const CAMP_IDX="monolith-campaigns";
function campKey(id,k){return `monolith-campaign-${id}${k?"-"+k:""}`}
function campScope(id){return "camp:"+id}
function campSlug(name){return slugify(name,32)}
function campBackupKind(id,name){const sl=campSlug(name);return `${GAME_INFO.id}-campaign-${sl?sl+"-":""}${id}`}
function gameId(){return GAME_INFO?GAME_INFO.id:""}
function campsAll(){let x=LS.get(CAMP_IDX,null);
  if(!x||typeof x!=="object"||!Array.isArray(x.list))x={list:[],current:{}};
  if(!x.current||typeof x.current!=="object")x.current={};
  x.list=x.list.filter(c=>c&&typeof c.id==="string"&&/^[a-z0-9]{1,24}$/.test(c.id)&&typeof c.game==="string");
  return x}
/* the campaign index, as seen by this game: {list, current, all} */
function campsLoad(){const x=campsAll();const g=gameId();
  let list=x.list.filter(c=>c.game===g);
  if(!list.length){const id=campNewIdIn(x);const s=defaultState();s.campaign.name=(RS.campaign&&RS.campaign.firstName)||"First campaign";s.host.password=newPassword();
    lsSet(campKey(id,"state"),s);x.list.push({id,game:g,ruleset:rulesetId(),gameVersion:GAME_INFO.version,name:s.campaign.name,created:Date.now(),updated:0,summary:gmSummary(s),crew:[]});x.current[g]=id;lsSet(CAMP_IDX,x);list=x.list.filter(c=>c.game===g)}
  let cur=x.current[g];if(!list.some(c=>c.id===cur)){cur=list[0].id;x.current[g]=cur;lsSet(CAMP_IDX,x)}
  return {list,current:cur,all:x}}
function campsSave(view){return lsSet(CAMP_IDX,view.all)}
function campNewIdIn(x){let id;const have=new Set(x.list.map(c=>c.id));do{id=uid().replace(/[^a-z0-9]/g,"").slice(0,12)}while(!id||have.has(id));return id}
function campCrew(s){return (s.party||[]).slice(0,8).map(c=>String(charLabel(c)).slice(0,40))}
function rulesetId(){if(!GAME)return "";for(const [k,v] of Object.entries(GAME.rulesets))if(v===RS)return k;return Object.keys(GAME.rulesets)[0]}
function charLabel(c){try{return (RS.character.label?RS.character.label(c):c.name)||"Unnamed"}catch(e){return "Unnamed"}}

const PW_WORDS=["basalt","obsidian","granite","onyx","slate","quartz","cobalt","ember","vector","signal","prism","static","cipher","echo","delta","nova","axis","orbit","carbon","helix"];
function newPassword(){return pick(PW_WORDS)+"-"+pick(PW_WORDS)+"-"+(1000+d(8999))}

let CUR=null;    // the open campaign's id
let st=null;     // the open campaign
const meta={lastSaved:0,lastDownload:0,changed:false,timer:null,vlist:[]};
function coreDefaults(){return {campaign:{name:"Untitled campaign",summary:"",notes:"",sessions:[],uid:""},party:[],players:{},maps:[],activeMap:null,roster:{},tableLog:[],
  host:{password:"",gmRollsPublic:false,playersMove:true,playersDraw:true,showNpcHealth:false,banned:[],bannedNames:{}}}}
function defaultState(){const g=RS&&RS.campaign&&RS.campaign.defaults?RS.campaign.defaults():{};const c=coreDefaults();const s={...g,...c};s.campaign.uid=uid();return s}
function fullState(data){const d0=defaultState();data=data&&typeof data==="object"?data:{};
  const out={...d0,...data,campaign:{...d0.campaign,...(data.campaign||{})},host:{...d0.host,...(data.host||{})}};
  ["party","maps","tableLog"].forEach(k=>{if(!Array.isArray(out[k]))out[k]=[]});["players","roster"].forEach(k=>{if(!out[k]||typeof out[k]!=="object")out[k]={}});
  out.party=out.party.filter(x=>x&&typeof x==="object").map(x=>{try{return RS.character.normalize(x)}catch(e){return null}}).filter(Boolean);
  if(RS.campaign&&RS.campaign.normalize)RS.campaign.normalize(out,d0);
  if(!out.campaign.uid)out.campaign.uid=uid();
  return out}
function gmSummary(s){try{if(RS.campaign&&RS.campaign.summary)return RS.campaign.summary(s)}catch(e){}
  return `${(s.party||[]).length} characters · ${(s.maps||[]).length} maps · ${(s.campaign&&s.campaign.sessions||[]).length} sessions`}
function campaignFileText(s,t){return JSON.stringify({format:"monolith-campaign",version:1,game:gameId(),ruleset:rulesetId(),gameVersion:GAME_INFO.version,app:"Monolith",savedAt:new Date(t||Date.now()).toISOString(),state:s},null,1)}
function gmBackupText(){return campaignFileText(st)}

let statusSaving=false;
function save(immediate){if(!statusSaving){statusSaving=true;setStatusText("Saving…","live")}clearTimeout(meta.timer);if(immediate)persist();else meta.timer=setTimeout(()=>idle(persist),600);scheduleSync()}
function persist(){clearTimeout(meta.timer);meta.timer=null;statusSaving=false;
  if(!lsSet(campKey(CUR,"state"),st)){setStatusText("Storage full: download a backup","warn");showNotice("Storage is full. Download a backup, then clear version history.");return}
  meta.lastSaved=Date.now();if(!meta.changed)meta.changed=true;saveMeta();
  campTouch();snapshot();updateStatus();gmDeskBackup()}
function saveMeta(){LS.set(campKey(CUR,"meta"),{savedAt:meta.lastSaved,lastDownload:meta.lastDownload,changed:meta.changed})}
// keep the campaign list (name, party, last played) in step with the open campaign
function campTouch(){const x=campsLoad();const e=x.list.find(c=>c.id===CUR);if(!e)return;e.name=String(st.campaign.name||"Untitled").slice(0,80);e.updated=Date.now();e.summary=gmSummary(st);e.crew=campCrew(st);e.ruleset=rulesetId();e.gameVersion=GAME_INFO.version;campsSave(x)}
// A new version at most every 5 minutes (or on demand); otherwise just a time check.
function snapshot(label,force){const last=meta.vlist[0];
  if(!force&&last&&Date.now()-last.t<5*60*1000)return;
  meta.vlist.unshift(Versions.add(campScope(CUR),label||"Autosave",clone(st),gmSummary(st)));
  if(meta.vlist.length>15)Versions.del(meta.vlist.splice(15).map(m=>m.key))}
function updateStatus(){setStatusText(meta.lastSaved?`Autosaved ${fmtTime(meta.lastSaved)}`:"Autosave on","live")}
function markDownloaded(){meta.lastDownload=Date.now();meta.changed=false;saveMeta()}
window.addEventListener("beforeunload",()=>{if(meta.timer)persist()});
document.addEventListener("visibilitychange",()=>{if(document.hidden&&meta.timer)persist()});
setInterval(()=>{if(meta.lastSaved)updateStatus()},30000);
const gmDeskBackup=deskBackupScheduler(()=>campBackupKind(CUR,st.campaign.name),()=>gmBackupText());

function pc(id){return st.party.find(c=>c.id===id)||null}
function restoreGm(data){snapshot("Before restoring a backup",true);st=fullState(data)}

/* ---------- files: campaign backups and character files ---------- */
function parseMonolithFile(text){let data;try{data=JSON.parse(text)}catch(e){return {error:"not valid JSON"}}
  const out={chars:[],camp:null,otherGame:""};if(!data||typeof data!=="object")return {error:"empty"};
  if(data.game&&data.game!==gameId()){out.otherGame=String(data.game).slice(0,40);return out}
  const ok=x=>{try{return RS.character.isCharacter(x)}catch(e){return false}};
  if(data.format==="monolith-character"&&ok(data.character))out.chars.push(data.character);
  else if(data.format==="monolith-roster"&&Array.isArray(data.characters))data.characters.forEach(x=>{if(ok(x))out.chars.push(x)});
  else if(data.format==="monolith-campaign"&&data.state&&typeof data.state==="object")out.camp=data.state;
  return out}
function importFiles(files){const asNew=ui.importAs==="new";ui.importAs=null;readFiles(files).then(list=>{let added=0,updated=0,gm=0,bad=0,other="";const gmFiles=[];
  list.forEach(f=>{const r=parseMonolithFile(f.text);if(r.error){bad++;return}
    if(r.otherGame){other=r.otherGame;bad++;return}
    if(r.camp){gmFiles.push({name:f.name,data:r.camp});return}
    if(!r.chars.length){bad++;return}
    r.chars.forEach(x=>{const c=RS.character.normalize(x);const i=st.party.findIndex(p=>p.id===c.id);if(i>=0){st.party[i]=c;updated++}else{st.party.push(c);added++}})});
  if(gmFiles.length&&asNew){gmFiles.forEach(g=>campCreate(g.data.campaign&&g.data.campaign.name||g.name.replace(/\.json$/i,""),g.data));gmFiles.length=0;gm=-1}
  if(added||updated)persist();render();
  if(gmFiles.length){ui.gmPending=gmFiles;ui.modal="gm-import";renderModal()}
  const parts=[];if(gm<0)parts.push("Campaign file imported. It's in your campaign list");if(added)parts.push(`${added} character${added>1?"s":""} added to the party`);if(updated)parts.push(`${updated} updated`);
  const msg=parts.length?parts.join(", ")+"."+(bad?` ${bad} file${bad>1?"s":""} skipped.`:""):(gmFiles.length?"":other?`That file is for another game (${other}). Open it from that game in Monolith.`:"No characters or campaign found in that file.");if(msg)showNotice(msg)})}
function rosterOnThisComputer(){const l=LS.get(`monolith-roster-${gameId()}`,null);return Array.isArray(l)?l.filter(c=>{try{return RS.character.isCharacter(c)&&RS.character.isFinished(c)}catch(e){return false}}):[]}
function charFileText(c){return JSON.stringify({format:"monolith-character",version:1,game:gameId(),ruleset:c.ruleset||rulesetId(),gameVersion:GAME_INFO.version,exportedAt:new Date().toISOString(),character:c},null,1)}
function charFileName(c,t){return `${safeName(charLabel(c))}_${stamp(t)}.${gameId()}.json`}

/* ============================== RENDER ============================== */
/* Tabs: the core's plus the game's. Each {id, label(), view(), order}. */
const CORE_TABS=[
  {id:"party",order:10,label:()=>`${(RS.gm&&RS.gm.partyName)||"Party"} · ${st.party.length}`,view:()=>viewParty()},
  {id:"map",order:30,label:()=>"Map",view:()=>viewMap()},
  {id:"campaign",order:60,label:()=>"Campaign",view:()=>viewCampaign()},
];
function gmTabs(){const extra=(RS.gm&&RS.gm.tabs)||[];return [...CORE_TABS,...extra].sort((a,b)=>(a.order||50)-(b.order||50))}
const HIDDEN_VIEWS={campaigns:()=>viewCampaigns()};
function render(){if(rq){cancelAnimationFrame(rq);rq=0}if(!st)return;runBeforeRender();renderNav();
  const t=gmTabs().find(x=>x.id===ui.tab);const v=t?t.view:HIDDEN_VIEWS[ui.tab]||viewParty;
  patch(app,v());renderModal();afterRender()}
function renderNav(){
  patch(document.getElementById("nav"),`<button class="campsw${ui.tab==="campaigns"?" on":""}" data-act="tab" data-t="campaigns" title="Switch, create or host another campaign"><span aria-hidden="true">⇄</span> <span class="cn">${esc(st.campaign.name||"Untitled")}</span></button>`
    +gmTabs().map(t=>`<button class="${ui.tab===t.id?"on":""}" data-act="tab" data-t="${t.id}">${esc(t.label())}</button>`).join("")+`<button data-act="open-modal" data-m="backups">Backups</button>${hostNavBtn()}`)}

/* ---------- PARTY ---------- */
function partyCard(c){const k=RS.character.card(c);return `<article class="card"><div class="card-top"><div class="portrait" style="background:${esc(k.color||"#3a3a3a")}">${esc(k.initial||"?")}</div>
  <div class="who"><div class="row" style="gap:6px">${(k.chips||[]).map(x=>`<span class="chip ${esc(x.c||"ink")}">${esc(x.t)}</span>`).join("")}${isOnline(c.id)?`<span class="chip green">Online</span>`:""}</div><h3>${esc(k.name)}</h3><div class="sub">${esc(k.sub||"")}${st.players[c.id]?" · "+esc(st.players[c.id]):""}</div></div></div>
  ${(k.stats||[]).length?`<div class="card-stats">${k.stats.map(([l,v])=>`<div><span class="label">${esc(l)}</span><b class="num">${esc(v)}</b></div>`).join("")}</div>`:""}
  <div class="card-foot">${RS.gm&&RS.gm.characterView?`<button class="btn sm" data-act="open-pc" data-id="${esc(c.id)}">Open</button>`:""}<button class="btn sm ghost" data-act="download-pc" data-id="${esc(c.id)}">File</button><button class="btn sm ghost" data-act="ask-remove-pc" data-id="${esc(c.id)}">Remove</button></div></article>`}
function viewParty(){
  if(ui.open&&pc(ui.open)&&RS.gm&&RS.gm.characterView)return RS.gm.characterView(pc(ui.open));
  const fromApp=rosterOnThisComputer();const noun=(RS.gm&&RS.gm.charNoun)||["character","characters"];
  const nudge=st.party.length&&meta.changed&&!Desk&&Date.now()-(meta.lastDownload||0)>3*24*3600*1000;
  const actions=RS.gm&&RS.gm.partyActions?RS.gm.partyActions():"";
  const list=RS.gm&&RS.gm.partyTable?RS.gm.partyTable(st.party):`<div class="cards">${st.party.map(partyCard).join("")}</div>`;
  return `<div class="roster-head"><h1><small>${esc(GAME_INFO.name)} · ${esc(st.campaign.name)}</small>${esc((RS.gm&&RS.gm.partyTitle)||"The party")}</h1>
    <div class="row"><button class="btn" data-act="pick-file">Add player files</button>${fromApp.length?`<button class="btn" data-act="load-player-app">Load from this computer (${fromApp.length})</button>`:""}${st.party.length?actions:""}</div></div>
  ${nudge?`<div class="banner warnb" style="margin-bottom:16px"><b>Last backup: ${meta.lastDownload?ago(meta.lastDownload):"never"}.</b> <button class="btn sm primary" data-act="download-all">Download backup</button></div>`:""}
  ${st.party.length?list+`<p class="faint" style="font-size:13px;margin-top:10px">Players who join your table bring their ${noun[0]} with them, and changes sync both ways while they're connected. Use <b>File</b> to hand a ${noun[0]} back to a player who isn't at the table.</p>`
  :`<div class="empty"><h3>No ${esc(noun[1])} in the party yet</h3><p class="muted" style="margin:0;max-width:62ch">Host a game and players join with their own ${esc(noun[1])}. Or add ${noun[0]} files your players sent you: drop them anywhere on this page.${fromApp.length?` ${noun[1][0].toUpperCase()+noun[1].slice(1)} built in the player screens on this computer can be loaded directly.`:""}</p><div class="row"><button class="btn primary" data-act="open-modal" data-m="host">Host a game…</button><button class="btn" data-act="pick-file">Add player files</button>${fromApp.length?`<button class="btn" data-act="load-player-app">Load from this computer</button>`:""}</div></div>`}`;
}

/* ---------- CAMPAIGN ---------- */
function viewCampaign(){
  const c=st.campaign;const sessions=(c.sessions||[]).slice().reverse();
  return `<div class="roster-head"><h1><small>Campaign · ${esc(GAME_INFO.name)}${RS.name&&RS.name!==GAME_INFO.name?" · "+esc(RS.name):""}</small>${esc(c.name||"Untitled")}</h1></div>
  <div class="roster-layout">
    <div style="display:grid;gap:14px;min-width:0">
      <section class="panel"><div class="panel-b" style="display:grid;gap:12px">
        <div class="field"><label class="label" for="c-name">Campaign name</label><input id="c-name" data-s="campaign.name" value="${esc(c.name||"")}"></div>
        <div class="field"><label class="label" for="c-sum">Where things stand</label><textarea id="c-sum" data-s="campaign.summary" placeholder="${esc((RS.gm&&RS.gm.summaryHint)||"Where the story is right now.")}">${esc(c.summary||"")}</textarea></div>
        <div class="field"><label class="label" for="c-notes">GM notes, threads & secrets</label><textarea id="c-notes" data-s="campaign.notes" style="min-height:180px" placeholder="Plots in motion, NPC agendas, what happens if the party does nothing">${esc(c.notes||"")}</textarea></div>
      </div></section>
      ${RS.gm&&RS.gm.campaignExtra?RS.gm.campaignExtra():""}
      <section class="panel"><div class="panel-h"><h3>Session log</h3><span class="faint mono" style="font-size:12px">${(c.sessions||[]).length} sessions</span></div><div class="panel-b" style="display:grid;gap:10px">
        <div class="field"><textarea id="sess-new" placeholder="Recap: what happened, who got hurt, what the party earned" style="min-height:70px"></textarea><button class="btn sm primary" data-act="add-session" style="justify-self:start">Log session ${(c.sessions||[]).length+1}</button></div>
        <div>${sessions.length?sessions.map(s=>`<div class="log-entry"><span class="n num">#${s.n}</span><div style="min-width:0;overflow-wrap:anywhere;white-space:pre-wrap">${esc(s.text)}</div><span class="faint mono" style="font-size:11px">${esc(s.date||"")}</span></div>`).join(""):`<p class="faint" style="margin:0">Recaps appear here, newest first.</p>`}</div>
      </div></section>
    </div>
    ${backupPanel()}
  </div>`;
}
function backupPanel(){return `<aside class="panel"><div class="panel-h"><h3>Autosave & backups</h3><span class="chip green">Autosave on</span></div><div class="panel-b" style="display:grid;gap:14px">
  <div><span class="label">Last autosave</span><div class="mono" style="font-size:15px;font-weight:600">${meta.lastSaved?fmtTime(meta.lastSaved):"Nothing yet"}</div><p class="faint" style="margin:4px 0 0;font-size:12.5px">The whole campaign saves as you work. ${meta.vlist.length} earlier versions kept.</p></div>
  <div style="display:grid;gap:6px"><span class="label">Backup files</span>${desktopBackupHTML()}</div>
  <div style="display:grid;gap:6px"><span class="label">Manual backup</span><div class="row"><button class="btn" data-act="download-all">Download campaign backup</button><button class="btn ghost" data-act="pick-file">Restore from file</button></div><span class="faint" style="font-size:12.5px">Last downloaded: ${meta.lastDownload?ago(meta.lastDownload):"never"}.</span></div>
  <hr class="sep" style="margin:0"><div class="row"><button class="btn sm" data-act="open-modal" data-m="backups">Version history</button>${RS.gm&&RS.gm.backupExtra?RS.gm.backupExtra():""}</div>
</div></aside>`}

/* ---------- modals ---------- */
Object.assign(MODALS,{
  backups:()=>({title:"Backups & version history",body:`<div style="display:grid;gap:18px">
    <section style="display:grid;gap:8px"><h3 class="mh">Back up the campaign</h3>
      <div class="row"><button class="btn primary" data-act="download-all">Download campaign backup (.json)</button><button class="btn" data-act="pick-file">Restore from a file…</button></div>
      <span class="faint" style="font-size:12.5px">A campaign backup holds everything in this campaign. When you restore one, you choose whether it replaces this campaign (the current state goes into history first) or becomes a new campaign in your list. Character files add to or update the party.</span>
      <div style="display:grid;gap:6px;padding:10px;border:1px dashed var(--line)"><span class="label">Backup files</span>${desktopBackupHTML()}</div></section>
    <section style="display:grid;gap:8px"><div class="row" style="justify-content:space-between"><h3 class="mh">Version history</h3><button class="btn sm" data-act="snap-now">Save a version now</button></div>
      <div class="items">${meta.vlist.map((h,i)=>`<div class="it"><div style="min-width:0"><div class="t">${fmtTime(h.t)} <span class="chip ink">${esc(h.label)}</span></div><div class="m">${esc(h.summary||"")}</div></div><div class="a"><button class="btn sm" data-act="hist-restore" data-i="${i}">Restore</button><button class="btn sm ghost" data-act="hist-download" data-i="${i}">Download</button></div></div>`).join("")||`<p class="faint" style="margin:0">Versions appear as you work.</p>`}</div></section>
    <section class="row" style="justify-content:space-between"><span class="faint" style="font-size:12.5px">Storage used by this campaign: ${fmtKB(lsSize(campKey(CUR,"")))}</span><button class="btn sm danger" data-act="clear-history">${ui.confirm==="clear-hist"?"Yes, clear version history":"Clear version history"}</button></section>
  </div>`}),
});

/* ---------- actions ---------- */
function withPc(id,fn){const c=pc(id);if(!c)return;fn(c);c.updatedAt=Date.now();save();render()}
Object.assign(A,{
  "tab":el=>{ui.tab=el.dataset.t;ui.confirm=null;ui.open=null;render();window.scrollTo(0,0)},
  "load-player-app":()=>{const l=rosterOnThisComputer();let a=0,u=0;l.forEach(x=>{const c=RS.character.normalize(x);const i=st.party.findIndex(p=>p.id===c.id);if(i>=0){st.party[i]=c;u++}else{st.party.push(c);a++}});save(true);render();showNotice(`Loaded ${a} new and ${u} updated from this computer.`)},
  "open-pc":el=>{ui.open=el.dataset.id;ui.confirm=null;render();window.scrollTo(0,0)},
  "close-pc":()=>{ui.open=null;render()},
  "download-pc":el=>{const c=pc(el.dataset.id);if(c)downloadText(charFileName(c),charFileText(c))},
  "add-session":()=>{const t=document.getElementById("sess-new").value.trim();if(!t)return;const s=st.campaign.sessions||(st.campaign.sessions=[]);s.push({n:s.length+1,text:t.slice(0,4000),date:new Date().toLocaleDateString("en-CA")});save(true);render()},
  "download-all":()=>{if(downloadText(`${gameId()}-campaign-${campSlug(st.campaign.name)||"campaign"}_${stamp()}.json`,gmBackupText())){markDownloaded();showNotice("Campaign backup downloaded.");requestRender()}},
  "snap-now":()=>{snapshot("Saved by hand",true);renderModal();showNotice("Version saved.")},
  "hist-restore":async el=>{const m=meta.vlist[Number(el.dataset.i)];if(!m)return;const h=await Versions.get(m.key);if(!h){showNotice("That version couldn't be read.");return}const data=clone(h.data);snapshot("Before restore",true);st=fullState(data);ui.modal=null;ui.open=null;persist();render();if(typeof MapV!=="undefined"&&MapV)MapV.invalidate();showNotice(`Restored the campaign to ${fmtTime(m.t)}.`)},
  "hist-download":async el=>{const m=meta.vlist[Number(el.dataset.i)];if(!m)return;const h=await Versions.get(m.key);if(h)downloadText(`${gameId()}-campaign_${stamp(m.t)}.json`,campaignFileText(h.data,m.t))},
  "clear-history":()=>{if(ui.confirm!=="clear-hist"){ui.confirm="clear-hist";renderModal();return}Versions.del(meta.vlist.map(m=>m.key));meta.vlist=[];ui.confirm=null;renderModal();showNotice("Version history cleared.")},
});
document.addEventListener("input",ev=>{const el=ev.target;if(!st)return;const num=el.type==="number";const val=num?(el.value===""?0:Number(el.value)):el.value;
  if(el.dataset.s){setPath(st,el.dataset.s,val);save()}
  else if(el.dataset.p){const [id,path]=el.dataset.p.split("|");const c=pc(id);if(c){setPath(c,path,val);c.updatedAt=Date.now();save()}}});

/* ---------- opening the console on the current campaign ---------- */
function gmLoadCampaign(){
  const x=campsLoad();CUR=x.current;
  const s=LS.get(campKey(CUR,"state"),null);st=fullState(s);
  const m=LS.get(campKey(CUR,"meta"),{})||{};meta.lastSaved=m.savedAt||0;meta.lastDownload=m.lastDownload||0;meta.changed=!!m.changed;
  if(!st.host.password)st.host.password=newPassword();
  ui.tab="party";ui.open=null;
}
