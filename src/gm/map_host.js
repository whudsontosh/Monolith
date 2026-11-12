/* ============================== GM: MAP EXTRAS ==============================
   The GM's side of what the map gained after 1.1: area templates (1.3), and token conditions,
   height and auras (1.4), walls and doors (1.5), light and sight (1.6). The GM's app is the only
   authority: players ask, and what they send is cleaned and checked here before it is applied. */
function tplList(m){if(!Array.isArray(m.templates))m.templates=[];return m.templates}
function tplTell(m,t){try{const f=GAME&&GAME.map&&GAME.map.onCaught;if(typeof f==="function")f({...t},Tpl.caught(t,m.grid,m.tokens||[]))}catch(e){console.error(e)}}
function tplApply(t,d,m){const c=Tpl.clean({...t,...d,shape:t.shape,id:t.id},m);if(!c)return;t.x=c.x;t.y=c.y;t.angle=c.angle;if(!t.fixed){t.size=c.size;t.width=c.width}}
function tplAfter(m){save();if(MapV)MapV.invalidate();requestRender()}
/* the GM's own map */
function gmTplEvent(type,d,m){
  switch(type){
    case "tpl-add":{const t=Tpl.clean(d,m);if(!t)return true;t.by="gm";const L=tplList(m);if(L.length>=80)L.shift();L.push(t);tplAfter(m);tplTell(m,t);return true}
    case "tpl-set":{const t=tplList(m).find(x=>x.id===d.id);if(t){tplApply(t,d,m);tplAfter(m);tplTell(m,t)}return true}
    case "tpl-del":{const L=tplList(m),i=L.findIndex(x=>x.id===d);if(i>=0){L.splice(i,1);tplAfter(m)}return true}
    case "tpl-select":requestRender();return true;
  }
  return false}
/* a player's request */
function playerTpl(conn,info,msg,m){
  const resync=()=>{Host.lastScene="";scheduleSync()};
  if(!m)return;if(st.host.playersTemplates===false){resync();return}
  const L=tplList(m),pid=info.playerId;
  if(msg.op==="add"){const t=Tpl.clean(msg.d,m);if(!t){resync();return}t.by=pid;if(L.some(x=>x.id===t.id))t.id=uid();
    const own=L.filter(x=>x.by===pid);if(own.length>=6)L.splice(L.indexOf(own[0]),1);if(L.length>=80)L.shift();L.push(t);tplAfter(m);tplTell(m,t);return}
  const t=L.find(x=>x.id===String(msg.id||(msg.d&&msg.d.id)||"")&&x.by===pid);if(!t){resync();return}
  if(msg.op==="set"){tplApply(t,msg.d||{},m);tplAfter(m);tplTell(m,t);return}
  if(msg.op==="del"){L.splice(L.indexOf(t),1);tplAfter(m)}}
Object.assign(A,{
  "tpl-clear":()=>{const m=curMap();if(!m)return;m.templates=[];if(MapV)MapV.tplSel=null;tplAfter(m)},
});
/* ---- walls and doors (walls.js) ---- */
function wallList(m){if(!Array.isArray(m.walls))m.walls=[];return m.walls}
function wallAfter(m){save();if(MapV)MapV.invalidate();requestRender()}
function gmWallEvent(type,d,m){const L=wallList(m);
  switch(type){
    case "wall-add":{const w=Walls.clean({...d,id:""},m);if(w&&L.length<8000){L.push(w);if(w.kind==="door"&&MapV)MapV.wallSel=w.id;wallAfter(m)}return true}
    case "wall-set":{for(const x of Array.isArray(d)?d:[]){const w=L.find(k=>k.id===x.id),c=w&&Walls.clean({...w,a:x.a,b:x.b},m);if(c){w.a=c.a;w.b=c.b}else if(w)L.splice(L.indexOf(w),1)}wallAfter(m);return true}
    case "wall-del":{const i=L.findIndex(k=>k.id===d);if(i>=0){L.splice(i,1);wallAfter(m)}return true}
    case "wall-select":requestRender();return true;
    case "door":{const w=L.find(k=>k.id===d.id&&k.kind==="door");if(!w)return true;
      if(d.lock){if(w.locked)delete w.locked;else{w.locked=true;delete w.open}}else if(w.open)delete w.open;else w.open=true;
      wallAfter(m);return true}
  }
  return false}
/* a player clicked a door: one of their tokens has to be next to it, and it must not be locked */
function playerDoor(conn,info,msg,m){const w=m&&(m.walls||[]).find(k=>k.id===String(msg.id||"")&&k.kind==="door");if(!w)return;
  const c=Walls.mid(w),g=m.grid,near=m.tokens.some(t=>t.owner===info.playerId&&!t.hidden&&Math.hypot(t.x-c.x,t.y-c.y)<=Grid.size(g)*2+Grid.tokR(g,t.size));
  if(!near){sendTo(conn,{t:"notice",text:"Move next to the door first."});return}
  if(w.locked){sendTo(conn,{t:"notice",text:"The door is locked."});return}
  if(w.open)delete w.open;else w.open=true;wallAfter(m)}
/* where a player's token really goes when they drag it: stopped by the first wall between where the drag began and
   where they want it. The GM's own drags are not checked. */
function wallCheckMove(m,t,x,y,final){if(!m.walls||!m.walls.length)return {x,y,hit:null};
  const F=Host.dragFrom||(Host.dragFrom=new Map()),now=Date.now();let o=F.get(t.id);if(!o||now-o.at>15000)o={x:t.x,y:t.y};o.at=now;
  if(final)F.delete(t.id);else F.set(t.id,o);
  return Walls.stop(m,o,{x,y},t)}
function wallBar(view,m){const sel=(m.walls||[]).find(w=>w.id===view.wallSel),n=(m.walls||[]).length;
  return `<div class="map-sub" role="toolbar" aria-label="Walls">
    <span class="seg">${Walls.KINDS.map(k=>`<button class="${!sel&&view.wallKind===k?"on":""}" data-act="wall-kind" data-v="${k}" title="${k==="wall"?"Stops movement and sight":k==="door"?"Stops both while closed; players can open it":k==="window"?"Stops movement, not sight":k==="invisible"?"Stops movement, not sight: a cliff edge, a force field":"Stops sight, not movement: smoke, a hedge"}"><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${Walls.LOOK[k].color};margin-right:5px"></i>${Walls.LOOK[k].name}</button>`).join("")}</span>
    ${sel?`<select data-act-change="wall-retype" aria-label="What the selected line is" style="width:auto;min-height:0;padding:4px 8px">${Walls.KINDS.map(k=>`<option value="${k}" ${sel.kind===k?"selected":""}>${Walls.LOOK[k].name}</option>`).join("")}</select>${sel.kind==="door"?`<button class="btn sm" data-act="wall-door" data-v="open">${sel.open?"Close it":"Open it"}</button><button class="btn sm" data-act="wall-door" data-v="lock">${sel.locked?"Unlock":"Lock"}</button>`:""}<button class="btn sm" data-act="wall-del">Remove</button><span class="faint" style="font-size:12px;color:#a1a4b8">Drag an end to move it.</span>`
      :`<span class="faint" style="font-size:12px;color:#a1a4b8">${view.wallChain?"Click to add the next corner. Double-click or Esc to finish.":"Click to start a wall. Click a wall to select it. Players never see these lines."}</span>`}
    ${n?`<span class="faint" style="font-size:12px;color:#a1a4b8">${n} on this map</span><button class="btn sm ${ui.confirm==="walls-clear"?"danger":""}" data-act="walls-clear">${ui.confirm==="walls-clear"?"Yes, remove all "+n:"Clear all"}</button>`:""}
  </div>`}
Object.assign(A,{
  "wall-kind":el=>{MapV.wallKind=el.dataset.v;MapV.wallSel=null;render();MapV.invalidate()},
  "wall-door":el=>{const m=curMap();if(m&&MapV.wallSel)gmWallEvent("door",{id:MapV.wallSel,lock:el.dataset.v==="lock"},m)},
  "wall-del":()=>{const m=curMap();if(m&&MapV.wallSel){const id=MapV.wallSel;MapV.wallSel=null;gmWallEvent("wall-del",id,m)}},
  "walls-clear":()=>{const m=curMap();if(!m||!(m.walls||[]).length)return;if(ui.confirm!=="walls-clear"){ui.confirm="walls-clear";render();return}
    ui.confirm=null;m.walls=[];MapV.wallSel=null;MapV.wallChain=null;wallAfter(m)},
});
Object.assign(CHANGE,{
  "wall-retype":el=>{const m=curMap(),w=m&&(m.walls||[]).find(k=>k.id===MapV.wallSel);if(!w||!Walls.KINDS.includes(el.value))return;w.kind=el.value;if(w.kind!=="door"){delete w.open;delete w.locked}wallAfter(m)},
});
/* a Universal VTT file from a map-making tool: the picture, the grid, and its walls and doors, as a new map */
async function importUvtt(file){showNotice("Reading the map…");const u=Walls.fromUvtt(await file.text());
  const bin=atob(u.image.replace(/^data:[^,]*,/,"").replace(/\s+/g,"")),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  const r=await prepareMapImage(new Blob([bytes]),4096),id=await uploadAsset(r.blob,r.ext),k=r.w/(u.cols*u.ppg);
  const nm=newMapData({name:cleanText(file.name.replace(/\.[^.]+$/,""),60)||"Map",asset:id,w:r.w,h:r.h,size:Math.round(u.ppg*k*100)/100});
  nm.walls=u.walls.map(w=>Walls.clean({...w,a:[w.a[0]*k,w.a[1]*k],b:[w.b[0]*k,w.b[1]*k]},nm)).filter(Boolean);
  if(u.lights.length){nm.lights=u.lights.map(l=>({x:Math.round(l.x*k),y:Math.round(l.y*k),r:l.r,color:l.color}));nm.lights=Vision.lights(nm)}
  st.maps.push(nm);ui.mapId=nm.id;if(!st.activeMap)st.activeMap=nm.id;save(true);render();MapV.fit();
  const doors=nm.walls.filter(w=>w.kind==="door").length;showNotice(`Map added with ${nm.walls.length-doors} wall${nm.walls.length-doors===1?"":"s"} and ${doors} door${doors===1?"":"s"}. Pick the Walls tool to see them.`)}

/* ---- token states: conditions, height, auras (tokens.js) ---- */
function tokFind(id){for(const m of [curMap(),activeMap()]){const t=m&&m.tokens.find(x=>x.id===id);if(t)return {t,m}}return null}
/* the GM's own change to any token */
function tokPatch(id,p){const f=tokFind(id);if(!f||!Cond.apply(f.t,p))return;save();if(MapV)MapV.invalidate();render()}
/* a player's request: only their own token, only conditions and height, and only while the GM allows it */
function playerTokSet(conn,info,msg,m){const t=m&&m.tokens.find(x=>x.id===String(msg.id||""));const p=msg.p&&typeof msg.p==="object"?msg.p:{};
  if(!t||t.hidden||t.owner!==info.playerId||st.host.playersConditions===false){Host.lastScene="";scheduleSync();return}
  const q={};if(p.cond)q.cond=p.cond;if("elev" in p)q.elev=p.elev;
  if(Cond.apply(t,q)){save();if(MapV)MapV.invalidate();requestRender()}}
/* the game ends a round: timed conditions count down, and the ones that run out come off with a note in the log */
function mapEndRound(){let changed=false;const done=[];
  for(const m of st.maps||[])for(const t of m.tokens||[]){if(!t.conds)continue;const keep=[];
    for(const e of Cond.cleanConds(t.conds)){if(e.rounds){changed=true;if(e.rounds<=1){if(m===activeMap()&&!t.hidden)done.push(`${t.label||"Token"} is no longer ${Cond.get(e.id).name.toLowerCase()}.`);continue}keep.push({id:e.id,rounds:e.rounds-1})}else keep.push(e)}
    if(keep.length)t.conds=keep;else delete t.conds}
  if(!changed)return 0;done.slice(0,12).forEach(text=>addLog({kind:"sys",text}));save();if(MapV)MapV.invalidate();requestRender();return done.length}
function tokAuraSet(i,patch){const t=selTok();if(!t)return;const L=Cond.cleanAuras(t.auras);
  if(patch===null)L.splice(i,1);else if(i>=L.length){if(L.length>=3)return;L.push({r:Grid.per(curMap().grid)*2,color:t.color&&/^#[0-9a-fA-F]{6}$/.test(t.color)?t.color:"#f2a93b",see:"all",...patch})}else Object.assign(L[i],patch);
  Cond.apply(t,{auras:L});save();MapV.invalidate();render()}
/* the token panel's extra rows */
function tokExtrasHTML(m,t){const g=m.grid,au=Cond.cleanAuras(t.auras),u=esc(Grid.unit(g));
  return `<div class="field"><span class="label">Conditions and height</span>${tokStateHTML(t,g)}</div>${tokSightHTML(m,t)}
    <div class="field"><div class="row" style="justify-content:space-between"><span class="label">Auras</span>${au.length<3?`<button class="btn sm ghost" data-act="tk-aura-add">+ Aura</button>`:""}</div>
      ${au.map((a,i)=>{const inside=Cond.auraCatches(g,t,a,m.tokens).map(k=>k.label||"Token");
        return `<div class="tka"><div class="row" style="gap:6px;flex-wrap:nowrap"><input type="number" min="0.5" step="any" value="${a.r}" data-act-change="tk-aura" data-i="${i}" data-k="r" aria-label="Aura ${i+1} reach in ${u}" style="width:5em"><span class="faint">${u}</span>
          <select data-act-change="tk-aura" data-i="${i}" data-k="see" aria-label="Who sees aura ${i+1}" style="width:auto"><option value="all" ${a.see==="all"?"selected":""}>Everyone sees it</option><option value="owner" ${a.see==="owner"?"selected":""}>Owner and GM</option><option value="gm" ${a.see==="gm"?"selected":""}>GM only</option></select>
          <button class="btn sm ghost" data-act="tk-aura-del" data-i="${i}" aria-label="Remove aura ${i+1}">×</button></div>
          <div class="row" style="gap:5px">${INK_COLORS.map(c=>`<button class="inkdot ${a.color===c?"on":""}" style="background:${c}" data-act="tk-aura-color" data-i="${i}" data-v="${c}" aria-label="Aura color ${c}"></button>`).join("")}</div>
          <p class="faint" style="margin:0;font-size:12px">${inside.length?"Reaches "+esc(inside.slice(0,8).join(", "))+(inside.length>8?"…":""):"Reaches nobody right now"}</p></div>`}).join("")}</div>`}
Object.assign(A,{
  "tk-aura-add":()=>tokAuraSet(99,{}),
  "tk-aura-del":el=>tokAuraSet(Number(el.dataset.i),null),
  "tk-aura-color":el=>tokAuraSet(Number(el.dataset.i),{color:el.dataset.v}),
  "map-end-round":()=>{const n=mapEndRound();showNotice(n?`Round ended. ${n} condition${n===1?"":"s"} ran out.`:"Round ended.")},
});
Object.assign(CHANGE,{
  "tk-aura":el=>tokAuraSet(Number(el.dataset.i),{[el.dataset.k==="see"?"see":"r"]:el.dataset.k==="see"?el.value:Number(el.value)||1}),
});
/* for games, on the map the GM is looking at. Sizes are in the map's units (ft, m).
   Tokens are named by their id, or by {ref} (the character or NPC a token stands for). */
function tokForGame(x){const m=curMap()||activeMap();if(!m)return null;if(x&&typeof x==="object"){if(x.id)x=x.id;else return m.tokens.find(t=>t.ref&&t.ref===x.ref)||null}return m.tokens.find(t=>t.id===x)||null}
Monolith.map={
  tokens(){const m=curMap()||activeMap();return m?m.tokens.map(t=>({id:t.id,ref:t.ref||null,kind:t.kind,label:t.label,x:t.x,y:t.y,size:t.size||1,elev:t.elev||0,conds:Cond.cleanConds(t.conds)})):[]},
  setCondition(tok,id,on,rounds){const t=tokForGame(tok);if(!t||!Cond.apply(t,{cond:{id,on:on!==false,rounds}}))return false;save();if(MapV)MapV.invalidate();requestRender();return true},
  hasCondition(tok,id){const t=tokForGame(tok);return !!(t&&Cond.cleanConds(t.conds).some(e=>e.id===id))},
  setElevation(tok,v){const t=tokForGame(tok);if(!t)return false;Cond.apply(t,{elev:v});save();if(MapV)MapV.invalidate();requestRender();return true},
  endRound(){return mapEndRound()},
  addTemplate(o){const m=curMap();if(!m||!o)return null;const per=Grid.per(m.grid);
    const t=Tpl.clean({...o,id:"",size:(Number(o.size)||per)/per,width:(Number(o.width)||per)/per},m);if(!t)return null;t.by="gm";if(o.fixed!==false)t.fixed=true;
    const L=tplList(m);if(L.length>=80)L.shift();L.push(t);tplAfter(m);tplTell(m,t);return t.id},
  removeTemplate(id){const m=curMap();if(!m)return false;const L=tplList(m),i=L.findIndex(x=>x.id===id);if(i<0)return false;L.splice(i,1);tplAfter(m);return true},
  templates(){const m=curMap();return m?tplList(m).map(t=>({...t})):[]},
  caught(id){const m=curMap();if(!m)return [];const t=tplList(m).find(x=>x.id===id);return t?Tpl.caught(t,m.grid,m.tokens||[]):[]},
};

/* ============================== light and sight (vision.js) ==============================
   With light and sight on for the map on the table, every player gets their own scene: only the tokens,
   doors and templates their tokens can see, plus two small pictures: what they see now, and what the
   party has seen before. A player with no token of their own gets the party's view. */
const VIS={cache:{},seen:{},t:0,saveT:0,n:0};
function eyesOfTok(t){return Vision.eyes(t,t.kind==="pc"&&t.ref?pc(t.ref):null)}
function lightList(m){if(!Array.isArray(m.lights))m.lights=[];else if(m.lights.some(l=>!l||!l.id||l.bright==null))m.lights=Vision.lights(m);return m.lights}
/* the picture of where the party has been, kept between sessions in map.seen */
function seenFor(m,W,H){let s=VIS.seen[m.id];
  if(!s||s.c.width!==W||s.c.height!==H){const c=Vision.canvas(W,H);if(s)c.getContext("2d").drawImage(s.c,0,0,W,H);s=VIS.seen[m.id]={c,src:s?s.src:null}}
  if(m.seen&&s.src!==m.seen&&!s.loading){s.loading=true;const url=m.seen,img=new Image();
    img.onload=()=>{s.c.getContext("2d").drawImage(img,0,0,s.c.width,s.c.height);s.loading=false;s.src=url;delete VIS.cache[m.id];if(MapV)MapV.invalidate();scheduleSync()};
    img.onerror=()=>{s.loading=false;s.src=url};img.src=url}
  return s}
/* everyone's view of a map, worked out again only when something it depends on has changed */
function visionFor(m){lightList(m);const key=Vision.key(m,eyesOfTok);let c=VIS.cache[m.id];if(c&&c.key===key)return c.V;
  const V=Vision.compute(m,eyesOfTok),s=seenFor(m,V.w,V.h),live=m===activeMap()&&Host.status==="online";
  if(live){s.c.getContext("2d").drawImage(V.party,0,0);   // exploring only counts on the map that is on the table
    clearTimeout(VIS.saveT);VIS.saveT=setTimeout(()=>{try{const u=s.c.toDataURL("image/png");if(u!==m.seen){m.seen=u;s.src=u;save()}}catch(e){console.error(e)}},2500)}
  V.seen=s.c;VIS.cache[m.id]={key,V,urls:{},n:++VIS.n};return V}
function visionForget(){Host.sceneSent={};Host.idsSent={};Host.sightSent={}}
function sceneForPlayer(pid){const m=activeMap();if(!m||!Vision.on(m))return sceneFor();const V=visionFor(m);return sceneFor(pid,V,V.by[pid]?pid:"")}
/* send each player their scene and pictures, if they changed. quick = mid-drag: only when what they can see changed */
function visionSync(m,quick){const V=visionFor(m),c=VIS.cache[m.id],url=who=>c.urls[who]||(c.urls[who]=(who==="seen"?V.seen:who?V.by[who]:V.party).toDataURL("image/png"));
  Host.sceneSent=Host.sceneSent||{};Host.idsSent=Host.idsSent||{};Host.sightSent=Host.sightSent||{};
  for(const [conn,i] of Host.conns){const pid=i.playerId,who=V.by[pid]?pid:"",sc=sceneFor(pid,V,who);
    const ids=sc.tokens.map(t=>t.id).join()+"|"+sc.doors.map(d=>d.id+(d.open?1:0)).join()+"|"+sc.templates.length;
    if(quick){if(ids!==Host.idsSent[conn]){Host.idsSent[conn]=ids;Host.sceneSent[conn]=null;sendTo(conn,{t:"scene",scene:sc})}}
    else{const js=JSON.stringify(sc);if(js!==Host.sceneSent[conn]){Host.sceneSent[conn]=js;Host.idsSent[conn]=ids;sendTo(conn,{t:"scene",scene:sc})}}
    const mk=c.n+"|"+who;if(Host.sightSent[conn]!==mk){Host.sightSent[conn]=mk;sendTo(conn,{t:"sight",vis:url(who),seen:url("seen")})}}}
/* a token moved: tell only the players who can see it, and bring everyone's view up to date a moment later */
function tokTell(m,t,final,except){const msg={t:"tok",id:t.id,x:t.x,y:t.y,final:!!final};
  if(!(m===activeMap()&&Vision.on(m))){broadcast(msg,except);return}
  if(Host.status!=="online"||!Host.conns.size)return;const c=VIS.cache[m.id],V=c&&c.V;
  for(const [conn,i] of Host.conns){if(conn===except)continue;if(t.owner===i.playerId||(V&&Vision.sees(V,V.by[i.playerId]?i.playerId:"",m.grid,t)))sendTo(conn,msg)}
  if(!VIS.t)VIS.t=setTimeout(()=>{VIS.t=0;const am=activeMap();if(am&&Vision.on(am)&&Host.status==="online"&&Host.conns.size)visionSync(am,true)},140)}
/* the GM's "what players see" preview: the selected token's player, or the whole party */
function gmPreviewSight(){const m=curMap();if(!m||!MapV||!MapV.preview||!Vision.on(m))return null;const V=visionFor(m),t=selTok(),who=t&&t.owner&&V.by[t.owner]?t.owner:"";
  return {vis:who?V.by[who]:V.party,seen:V.seen,sees:k=>(who&&k.owner===who)||Vision.sees(V,who,m.grid,k)}}
function visionAfter(m){save();if(MapV)MapV.invalidate();requestRender()}
function gmLightEvent(type,d,m){const L=lightList(m);
  switch(type){
    case "light-add":{const n=ui.lightNew||{},per=Grid.per(m.grid),l=Vision.cleanLight({x:d.x,y:d.y,bright:n.bright!=null?n.bright:per*4,dim:n.dim!=null?n.dim:per*4,color:n.color,angle:n.angle,dir:0},m);
      if(l&&L.length<400){L.push(l);MapV.lightSel=l.id;visionAfter(m)}return true}
    case "light-set":{const l=L.find(x=>x.id===d.id);if(l){const c=Vision.cleanLight({...l,...d,id:l.id},m);if(c)Object.assign(l,c)}visionAfter(m);return true}
    case "light-del":{const i=L.findIndex(x=>x.id===d);if(i>=0){L.splice(i,1);visionAfter(m)}return true}
    case "light-select":requestRender();return true;
  }
  return false}
function lightEdit(patch){const m=curMap();if(!m)return;const l=lightList(m).find(x=>x.id===MapV.lightSel);
  if(l){const c=Vision.cleanLight({...l,...patch,id:l.id},m);if(c){for(const k of ["angle","dir"])delete l[k];Object.assign(l,c)}visionAfter(m)}
  else{ui.lightNew={...(ui.lightNew||{}),...patch};render()}}
function lightBar(view,m){const g=m.grid,u=esc(Grid.unit(g)),per=Grid.per(g),sel=lightList(m).find(l=>l.id===view.lightSel),n=ui.lightNew||{},cur=sel||{bright:n.bright!=null?n.bright:per*4,dim:n.dim!=null?n.dim:per*4,color:n.color||"#ffd94a",angle:n.angle||0};
  const amb=Vision.ambient(m),inp=(k,label)=>`<label class="faint" style="font-size:12px;color:#a1a4b8;display:flex;align-items:center;gap:5px">${label} <input type="number" min="0" step="any" value="${cur[k]||0}" data-act-change="light-num" data-k="${k}" style="width:4.8em;min-height:0;padding:3px 6px" aria-label="${label} (${u})"> ${u}</label>`;
  return `<div class="map-sub" role="toolbar" aria-label="Lights">
    <span class="label" style="color:#a1a4b8">${sel?"This light":"New lights"}</span>${inp("bright","Bright")}${inp("dim","then dim for")}
    <select data-act-change="light-beam" aria-label="Beam" style="width:auto;min-height:0;padding:4px 8px">${[[0,"All round"],[120,"Wide beam"],[60,"Beam"],[30,"Narrow beam"]].map(([v,l])=>`<option value="${v}" ${(cur.angle||0)===v?"selected":""}>${l}</option>`).join("")}</select>
    <span class="inks">${INK_COLORS.map(c=>`<button class="inkdot ${cur.color===c?"on":""}" style="background:${c}" data-act="light-color" data-v="${c}" aria-label="Color ${c}"></button>`).join("")}</span>
    ${sel?`<button class="btn sm" data-act="light-del">Remove</button><span class="faint" style="font-size:12px;color:#a1a4b8">Drag to move it${sel.angle?", Shift+drag to aim it":""}.</span>`:`<span class="faint" style="font-size:12px;color:#a1a4b8">Click the map to place a light. Players never see these marks.</span>`}
    <span class="label" style="color:#a1a4b8">This map is</span><span class="seg">${[["day","Lit"],["dim","Dim"],["dark","Dark"]].map(([k,l])=>`<button class="${amb===k?"on":""}" data-act="map-ambient" data-v="${k}" title="${k==="day"?"Everything in sight shows":k==="dim"?"Everything in sight shows dimly; lights show clearly":"Only lights and dark sight show anything"}">${l}</button>`).join("")}</span>
    ${Vision.on(m)?"":`<span class="faint" style="font-size:12px;color:#ffb057">Light and sight are off for this map (Map settings).</span>`}
  </div>`}
/* the token panel: what this token sees, and the light it carries */
function tokSightHTML(m,t){const u=esc(Grid.unit(m.grid)),e=eyesOfTok(t),own=t.sight||{},lt=t.light||{},g=Vision.eyes({...t,sight:null,light:null},t.kind==="pc"&&t.ref?pc(t.ref):null);
  const f=(k,label,val,ph,title)=>`<label class="tks-e" title="${title}">${label} <input type="number" min="0" step="any" value="${val||""}" placeholder="${ph}" data-act-change="tk-sight" data-k="${k}" aria-label="${label} (${u})"> ${u}</label>`;
  return `<div class="field"><span class="label">Sight and light</span><div class="tks">
    ${t.owner?f("dark","Sees in the dark",own.dark,g.dark||0,"How far this token sees with no light at all")+f("range","Sees no further than",own.range,g.range||"∞","Leave empty for no limit"):`<p class="faint" style="margin:0;font-size:12px">Only a player's token gives sight. This one can still carry a light.</p>`}
    ${f("bright","Carries a light: bright",lt.bright,(g.light&&g.light.bright)||0,"A torch, a lantern, a flashlight")}${f("dim","then dim for",lt.dim,(g.light&&g.light.dim)||0,"How much further the dim light reaches")}
  </div></div>`}
function visionSettingsHTML(m){const v=m.vision===true?"on":m.vision===false?"off":"auto";
  return `<div class="field" style="margin-top:8px"><label class="label" for="mm-vision">Light and sight</label><select id="mm-vision" data-act-change="map-vision">
      <option value="auto" ${v==="auto"?"selected":""}>Automatic: on once this map has walls (${Vision.on(m)?"on now":"off now"})</option><option value="on" ${v==="on"?"selected":""}>On: players see only what their tokens see</option><option value="off" ${v==="off"?"selected":""}>Off: players see the whole map</option></select></div>
    <div class="row" style="justify-content:space-between;gap:8px"><span class="seg">${[["day","Lit"],["dim","Dim"],["dark","Dark"]].map(([k,l])=>`<button class="${Vision.ambient(m)===k?"on":""}" data-act="map-ambient" data-v="${k}">${l}</button>`).join("")}</span>
      <button class="btn sm ghost ${ui.confirm==="vision-reset"?"danger":""}" data-act="vision-reset" title="Players' maps go dark again except where their tokens see right now">${ui.confirm==="vision-reset"?"Yes, forget it":"Forget explored areas"}</button></div>`}
Object.assign(A,{
  "light-color":el=>lightEdit({color:el.dataset.v}),
  "light-del":()=>{const m=curMap();if(m&&MapV.lightSel){const id=MapV.lightSel;MapV.lightSel=null;gmLightEvent("light-del",id,m)}},
  "map-ambient":el=>{const m=curMap();if(!m||!Vision.AMBIENT.includes(el.dataset.v))return;m.ambient=el.dataset.v;visionAfter(m);render()},
  "vision-reset":()=>{const m=curMap();if(!m)return;if(ui.confirm!=="vision-reset"){ui.confirm="vision-reset";render();return}
    ui.confirm=null;delete m.seen;delete VIS.seen[m.id];delete VIS.cache[m.id];Host.lastScene="";visionAfter(m);render();showNotice("Explored areas forgotten for this map.")},
});
Object.assign(CHANGE,{
  "light-num":el=>lightEdit({[el.dataset.k==="dim"?"dim":"bright"]:Math.max(0,Number(el.value)||0)}),
  "light-beam":el=>lightEdit({angle:Number(el.value)||0}),
  "map-vision":el=>{const m=curMap();if(!m)return;if(el.value==="on")m.vision=true;else if(el.value==="off")m.vision=false;else delete m.vision;Host.lastScene="";visionAfter(m);render()},
  "tk-sight":el=>{const t=selTok(),k=el.dataset.k,v=Math.max(0,Number(el.value)||0);if(!t)return;
    if(k==="dark"||k==="range"){const s2={...(t.sight||{})};if(v)s2[k]=v;else delete s2[k];if(Object.keys(s2).length)t.sight=s2;else delete t.sight}
    else{const l={...(t.light||{})};if(v)l[k]=v;else delete l[k];if(l.bright||l.dim)t.light={bright:l.bright||0,dim:l.dim||0,color:l.color||"#ffd94a"};else delete t.light}
    visionAfter(curMap());render()},
});
