
/* ============================== MONOLITH GM: HOSTING, THE TABLE AND THE MAP ==============================
   The GM's window is the only authority on table state. Players' messages arrive through the
   table server; core messages (tokens, map, pings, chat, rolls, presence) are handled here and
   game messages ({t:"game", type}) are handed to the game. */
const Host={ws:null,ready:false,port:0,key:"",mode:"off",status:"off",url:"",lan:[],publicIp:"",err:"",tunnelMsg:"",conns:new Map(),lastScene:"",syncT:null,charSent:{},directPort:47021};
const GM_COLOR=()=>(Monolith.theme.gmColor||"#ffffff");
function isOnline(charId){for(const i of Host.conns.values())if(i.charId===charId)return true;return false}
function adminSend(o){if(Host.ws&&Host.ws.readyState===1)Host.ws.send(JSON.stringify(o))}
function sendTo(conn,msg){adminSend({to:conn,msg})}
function broadcast(msg,except){if(Host.status==="online"&&Host.conns.size)adminSend({to:"*",except,msg})}
function pushConfig(){adminSend({ctl:"config",open:Host.status==="online",password:st.host.password,max:12})}
function adminConnect(){
  if(!Host.port)return;
  const ws=new WebSocket(`ws://127.0.0.1:${Host.port}/ws?role=admin&k=${encodeURIComponent(Host.key)}`);Host.ws=ws;
  ws.onopen=()=>{Host.ready=true;pushConfig();requestRender()};
  ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch(_){return}try{onServer(m)}catch(err){console.error(err)}};
  ws.onclose=()=>{if(Host.ws!==ws)return;Host.ready=false;Host.conns.clear();setTimeout(adminConnect,1500);requestRender()};
}
async function hostInit(){
  if(!st.host.password)st.host.password=newPassword();
  if(!Desk)return;
  try{const info=await Desk.serverInfo();Host.port=info.port;Host.key=info.adminKey;
    // the app window may have been reloaded while the table was open: pick the session back up
    const hs=Desk.hostState?await Desk.hostState().catch(()=>null):null;
    if(hs&&hs.tunnel&&hs.tunnel.state==="online"&&hs.tunnel.url){Host.mode="online";Host.url=hs.tunnel.url;Host.status="online"}
    else if(hs&&hs.direct){Host.directPort=hs.direct;Host.lan=await Desk.lanIps().catch(()=>[]);Host.publicIp=await Desk.publicIp().catch(()=>"");Host.mode="direct";Host.url=`http://${Host.publicIp||Host.lan[0]||"127.0.0.1"}:${hs.direct}`;Host.status="online"}
    adminConnect();requestRender()}catch(e){Host.err="The table server didn't start: "+(e.message||e)}
  if(Desk.onTunnel)Desk.onTunnel(s=>{Host.tunnelMsg=s.msg||"";
    if(s.state==="down"&&Host.mode==="online"){Host.status="off";Host.mode="off";Host.err=s.msg;pushConfig();addLog({kind:"sys",text:"The online link dropped. Go online again to let players back in."})}
    requestRender()});
}
function setHosting(mode,url){Settings.set("hostLast",{mode,port:mode==="direct"?Host.directPort:(Settings.get("hostLast",{})||{}).port||0});Host.mode=mode;Host.url=url;Host.status="online";Host.err="";pushConfig();Host.lastScene="";addLog({kind:"sys",text:mode==="local"?"Table open on this computer.":"Table is online. Share the invite code."});save(true);render()}
async function hostOnline(){
  if(!Desk)return;Host.err="";Host.status="starting";Host.mode="online";Host.tunnelMsg="Starting…";render();
  try{const url=await Desk.tunnelStart();setHosting("online",url)}
  catch(e){Host.status="off";Host.mode="off";Host.err=String(e&&e.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/,"");render()}
}
async function hostDirect(){
  if(!Desk)return;const port=clamp(Number(document.getElementById("host-port")?.value)||Host.directPort,1024,65535);Host.directPort=port;Host.err="";Host.status="starting";Host.mode="direct";Host.tunnelMsg="Opening port "+port+"…";render();
  try{const r=await Desk.directStart(port);Host.lan=await Desk.lanIps().catch(()=>[]);Host.publicIp=await Desk.publicIp().catch(()=>"");
    setHosting("direct",`http://${Host.publicIp||Host.lan[0]||"127.0.0.1"}:${r.port}`)}
  catch(e){Host.status="off";Host.mode="off";Host.err="Couldn't open port "+port+". It may be in use; try another number.";render()}
}
function hostLocal(){if(!Host.port)return;setHosting("local",`http://127.0.0.1:${Host.port}`)}
async function hostStop(){
  broadcast({t:"end",reason:"The GM closed the table."});const mode=Host.mode;
  Host.status="off";Host.mode="off";Host.url="";pushConfig();Host.conns.clear();
  try{if(mode==="online")await Desk.tunnelStop();if(mode==="direct")await Desk.directStop()}catch(e){}
  addLog({kind:"sys",text:"Table closed."});render()
}
function inviteCode(){return Host.url?makeInvite(Host.url,st.host.password,st.campaign.name||"the table",gameId()):""}
function presence(){return [...Host.conns.values()].map(i=>{const c=pc(i.charId);return {playerId:i.playerId,name:i.name,handle:c?charLabel(c):"",color:i.color}})}
function broadcastPresence(){broadcast({t:"presence",players:presence()})}
function addLog(e){e.t=Date.now();st.tableLog=st.tableLog||[];st.tableLog.push(e);if(st.tableLog.length>200)st.tableLog.splice(0,st.tableLog.length-200);broadcast({t:"log",e});save();if(ui.tab==="map")requestRender()}

/* ---------- maps ---------- */
function activeMap(){return (st.maps||[]).find(m=>m.id===st.activeMap)||null}
function curMap(){return (st.maps||[]).find(m=>m.id===ui.mapId)||activeMap()||(st.maps||[])[0]||null}
function freeSpot(m,x,y){const g=Math.max(4,Number(m.grid.size)||70);const s0=snapPoint(m.grid,x,y,1);
  for(let r=0;r<12;r++)for(let dx=-r;dx<=r;dx++)for(let dy=-r;dy<=r;dy++){if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;
    const px=s0.x+dx*g,py=s0.y+dy*g;if(px<0||py<0||px>m.w||py>m.h)continue;if(!(m.tokens||[]).some(t=>Math.hypot(t.x-px,t.y-py)<g*0.8))return {x:px,y:py}}
  return s0}
function viewCenter(m){if(MapV&&MapV.map===m&&MapV.cw>2){const w=MapV.toWorld(MapV.cw/2,MapV.ch/2);return {x:clamp(w.x,0,m.w),y:clamp(w.y,0,m.h)}}return {x:m.w/2,y:m.h/2}}
function charColor(c){try{return RS.character.card(c).color||"#7d7d7d"}catch(e){return "#7d7d7d"}}
function ensurePcToken(m,c,pid){if(!m||!c)return null;let t=m.tokens.find(x=>x.kind==="pc"&&x.ref===c.id);
  if(t){if(pid)t.owner=pid;t.label=charLabel(c);t.color=charColor(c)||t.color;return t}
  const p=freeSpot(m,m.w/2,m.h/2);t={id:uid(),kind:"pc",ref:c.id,owner:pid||((Object.entries(st.roster||{}).find(([k,r])=>r.charId===c.id)||[])[0])||null,label:charLabel(c),color:charColor(c),size:1,x:p.x,y:p.y,hidden:false};
  m.tokens.push(t);return t}
/* health rings come from the game: rules.gm.tokenRing(token) -> {color, frac, dead} */
function tokenRing(t){try{return RS.gm&&RS.gm.tokenRing?RS.gm.tokenRing(t)||null:null}catch(e){return null}}
/* whose turn it is (the game's combat tracker): rules.gm.activeTurn() -> {kind, ref} */
function activeTokId(m){if(!m||!(RS.gm&&RS.gm.activeTurn))return null;let a=null;try{a=RS.gm.activeTurn()}catch(e){}if(!a)return null;
  const t=m.tokens.find(x=>x.kind===a.kind&&x.ref===a.ref);return t?t.id:null}
function sceneFor(){const m=activeMap();if(!m)return null;const showNpc=!!st.host.showNpcHealth;
  return {id:m.id,name:m.name,asset:m.asset,w:m.w,h:m.h,bg:m.bg,grid:m.grid,fog:{on:!!m.fog.on,shapes:m.fog.shapes},drawings:m.drawings,
    tokens:m.tokens.filter(t=>!t.hidden).map(t=>({id:t.id,kind:t.kind,owner:t.owner||null,label:t.label,color:t.color,size:t.size||1,x:t.x,y:t.y,img:t.img||null,ring:(t.kind!=="npc"||showNpc)?tokenRing(t):null})),
    active:activeTokId(m),settings:{playersMove:st.host.playersMove!==false,playersDraw:st.host.playersDraw!==false}}}
function scheduleSync(){if(Host.status!=="online"||!Host.conns.size)return;clearTimeout(Host.syncT);Host.syncT=setTimeout(syncNow,120)}
function syncNow(){if(Host.status!=="online"||!Host.conns.size)return;
  const sc=sceneFor();const s=JSON.stringify(sc);if(s!==Host.lastScene){Host.lastScene=s;broadcast({t:"scene",scene:sc})}
  for(const [conn,i] of Host.conns){const c=pc(i.charId);if(c&&(Number(c.updatedAt)||0)>(Host.charSent[conn]||0)){Host.charSent[conn]=Number(c.updatedAt)||0;sendTo(conn,{t:"char",character:c})}}}
function kick(conn,reason){adminSend({ctl:"kick",conn,reason})}

/* ---------- server events ---------- */
function onServer(m){
  if(m.ev==="admin-ok"){(m.players||[]).forEach(p=>onJoin(p.conn,p.msg,true));return}
  if(m.ev==="join"){onJoin(m.conn,m.msg,false);return}
  if(m.ev==="leave"){const i=Host.conns.get(m.conn);Host.conns.delete(m.conn);delete Host.charSent[m.conn];if(MapV)MapV.setRemoteRuler(m.conn,null);
    if(i){addLog({kind:"sys",text:`${i.name} left the table.`});broadcastPresence()}render();return}
  if(m.ev==="msg")onMsg(m.conn,m.msg);
}
/* every player runs exactly the game version the GM runs */
function gameMismatch(conn,h){const g=h&&h.game||{};
  if(g.id!==gameId()){sendTo(conn,{t:"need-game",game:gameId(),name:GAME_INFO.name,version:GAME_INFO.version,wrong:true});kick(conn,`This table plays ${GAME_INFO.name}. Open ${GAME_INFO.name} in Monolith to join it.`);return true}
  if(g.version!==GAME_INFO.version){sendTo(conn,{t:"need-game",game:gameId(),name:GAME_INFO.name,version:GAME_INFO.version});kick(conn,`This table uses ${GAME_INFO.name} ${GAME_INFO.version}. Monolith is getting that version for you.`);return true}
  return false}
function onJoin(conn,h,silent){
  if(Host.status!=="online"){kick(conn,"The table is closed.");return}
  const pid=String(h&&h.playerId||"").replace(/[^A-Za-z0-9_-]/g,"").slice(0,64);
  if(!pid){kick(conn,"Your app sent an incomplete join request. Update Monolith and try again.");return}
  if((st.host.banned||[]).includes(pid)){kick(conn,"The GM removed you from this table.");return}
  if(gameMismatch(conn,h))return;
  if(h.peek){sendTo(conn,{t:"peek",table:{name:st.campaign.name||"the table",id:st.campaign.uid}});if(RS.gm&&RS.gm.onPeek)RS.gm.onPeek(conn);sendTo(conn,{t:"peek-done"});return}
  for(const [cid,i] of Host.conns)if(i.playerId===pid&&cid!==conn){kick(cid,"You joined from another window.");Host.conns.delete(cid)}
  let inc=null;try{if(h.character&&JSON.stringify(h.character).length<800000&&RS.character.isCharacter(h.character))inc=RS.character.normalize(h.character)}catch(e){}
  if(!inc){kick(conn,`Pick a ${((RS.gm&&RS.gm.charNoun)||["character"])[0]} before joining.`);return}
  inc.id=String(inc.id).replace(/[^A-Za-z0-9_-]/g,"").slice(0,48)||uid();if(RS.character.joined)RS.character.joined(inc);
  const name=cleanText(h.name,40)||cleanText(charLabel(inc),40)||"Player";
  const idx=st.party.findIndex(p=>p.id===inc.id);let c;let sendBack=false;
  if(idx<0){st.party.push(inc);c=inc}
  else if((Number(inc.updatedAt)||0)>=(Number(st.party[idx].updatedAt)||0)){st.party[idx]=inc;c=inc}
  else{c=st.party[idx];sendBack=true}
  st.players[c.id]=name;
  const r=st.roster[pid]||(st.roster[pid]={first:Date.now()});r.name=name;r.charId=c.id;r.last=Date.now();
  Host.conns.set(conn,{playerId:pid,name,charId:c.id,color:charColor(c)});
  const m=activeMap();if(m)ensurePcToken(m,c,pid);
  Host.charSent[conn]=Number(c.updatedAt)||0;
  if(RS.gm&&RS.gm.beforeWelcome)try{RS.gm.beforeWelcome(conn)}catch(e){console.error(e)}
  sendTo(conn,{t:"welcome",you:{playerId:pid,charId:c.id},table:{name:st.campaign.name||"the table",id:st.campaign.uid},scene:sceneFor(),log:(st.tableLog||[]).slice(-60),players:presence(),char:sendBack?c:null});
  if(RS.gm&&RS.gm.onJoined)try{RS.gm.onJoined(conn,Host.conns.get(conn),c)}catch(e){console.error(e)}
  if(!silent){addLog({kind:"sys",text:`${name} joined as ${charLabel(c)}.`});showNotice(`${name} joined as ${charLabel(c)}.`)}
  Host.lastScene="";save(true);broadcastPresence();render();
}
function cleanDrawing(d){if(!d||typeof d!=="object")return null;const type=["pen","line","rect"].includes(d.type)?d.type:"pen";
  const pts=Array.isArray(d.pts)?d.pts.slice(0,4000).map(Number).filter(n=>isFinite(n)):[];if(pts.length<4||pts.length%2)return null;
  const color=INK_COLORS.includes(d.color)?d.color:INK_COLORS[0];const id=String(d.id||"").replace(/[^A-Za-z0-9]/g,"").slice(0,24)||uid();
  return {id,type,color,w:clamp(Number(d.w)||3,0.3,80),pts:pts.map(v=>Math.round(v*10)/10)}}
function onMsg(conn,m){
  const info=Host.conns.get(conn);if(!info||!m)return;const mp=activeMap();
  switch(m.t){
    case "char":{let inc;try{if(!RS.character.isCharacter(m.character))return;inc=RS.character.normalize(m.character)}catch(e){return}if(inc.id!==info.charId)return;const i=st.party.findIndex(p=>p.id===inc.id);if(i<0)return;
      if((Number(inc.updatedAt)||0)>(Number(st.party[i].updatedAt)||0)){if(RS.character.joined)RS.character.joined(inc);st.party[i]=inc;Host.charSent[conn]=Number(inc.updatedAt)||0;info.color=charColor(inc)||info.color;
        (st.maps||[]).forEach(mm=>mm.tokens.forEach(t=>{if(t.kind==="pc"&&t.ref===inc.id){t.label=charLabel(inc)||t.label;t.color=charColor(inc)||t.color}}));save();requestRender()}
      return}
    case "move":{if(!mp)return;const t=mp.tokens.find(x=>x.id===m.id);if(!t)return;
      if(!(st.host.playersMove!==false&&t.owner===info.playerId)){sendTo(conn,{t:"tok",id:t.id,x:t.x,y:t.y,final:true});return}
      t.x=clamp(Number(m.x)||0,0,mp.w);t.y=clamp(Number(m.y)||0,0,mp.h);if(!t.hidden)broadcast({t:"tok",id:t.id,x:t.x,y:t.y,final:!!m.final},conn);
      if(MapV)MapV.invalidate();if(m.final)save();return}
    case "ping":{const x=Number(m.x)||0,y=Number(m.y)||0;broadcast({t:"ping",x,y,color:info.color,name:info.name},conn);if(MapV&&curMap()===mp){MapV.addPing(x,y,info.color)}return}
    case "ruler":{const r=m.r&&Array.isArray(m.r.a)&&Array.isArray(m.r.b)?{a:m.r.a.slice(0,2).map(Number),b:m.r.b.slice(0,2).map(Number)}:null;
      broadcast({t:"ruler",by:conn,name:info.name,color:info.color,r},conn);if(MapV)MapV.setRemoteRuler(conn,r?{...r,name:info.name,color:info.color}:null);return}
    case "draw":{if(!mp)return;
      if(m.op==="add"){if(st.host.playersDraw===false)return;const dr=cleanDrawing(m.d);if(!dr)return;dr.by=info.playerId;if(mp.drawings.some(x=>x.id===dr.id))dr.id=uid();
        mp.drawings.push(dr);if(mp.drawings.length>600)mp.drawings.shift();save();if(MapV)MapV.invalidate();return}
      if(m.op==="del"){const i=mp.drawings.findIndex(x=>x.id===m.id&&x.by===info.playerId);if(i>=0){mp.drawings.splice(i,1);save();if(MapV)MapV.invalidate()}return}
      return}
    case "roll":{const e=m.e||{};const c=pc(info.charId);const entry={kind:"roll",pid:info.playerId,who:(c&&charLabel(c))||info.name,color:info.color,label:cleanText(e.label,80),detail:cleanText(e.detail,140),total:Number(e.total)||0,tags:cleanTags(e.tags)};
      addLog(entry);Dice.push({who:entry.who,label:entry.label,detail:entry.detail,total:entry.total,tags:entry.tags,t:Date.now(),remote:true});return}
    case "chat":{const text=cleanText(m.text,500);if(!text)return;addLog({kind:"chat",pid:info.playerId,who:info.name,color:info.color,text});return}
    case "game":{if(m.game!==gameId()||typeof m.type!=="string")return;if(RS.gm&&RS.gm.onMessage)try{RS.gm.onMessage(conn,info,m.type.slice(0,40),m)}catch(e){console.error(e)}return}
  }
}

/* ---------- GM dice: public or hidden ---------- */
{const _push=Dice.push.bind(Dice);Dice.push=function(e){_push(e);if(e.remote)return;
  if(Host.status==="online"&&st.host.gmRollsPublic)addLog({kind:"roll",pid:"gm",who:e.who&&e.who!=="GM"?e.who+" (GM)":"GM",color:GM_COLOR(),label:e.label,detail:e.detail,total:e.total,tags:e.tags})}}
/* ---------- game messages ---------- */
function gameSendTo(conn,type,data){sendTo(conn,{...(data||{}),t:"game",game:gameId(),type})}
function gameBroadcast(type,data,except){broadcast({...(data||{}),t:"game",game:gameId(),type},except)}

/* ============================== GM: MAP VIEW ============================== */
let MapV=null;
function gmMapEvent(type,d){const m=curMap();if(!m)return;const live=m===activeMap()&&Host.status==="online";
  switch(type){
    case "select":ui.mapSel=d;requestRender();return;
    case "token-dbl":ui.mapSel=d;render();setTimeout(()=>document.getElementById("tk-label")?.focus(),30);return;
    case "token-del":{const i=m.tokens.findIndex(t=>t.id===d);if(i>=0){m.tokens.splice(i,1);ui.mapSel=null;save();render();MapV.invalidate()}return}
    case "move":{const t=m.tokens.find(x=>x.id===d.id);if(!t)return;if(live&&!t.hidden)broadcast({t:"tok",id:t.id,x:t.x,y:t.y,final:d.final});if(d.final){save();requestRender()}return}
    case "draw-add":d.by="gm";m.drawings.push(d);if(m.drawings.length>600)m.drawings.shift();save();MapV.invalidate();return;
    case "draw-del":{const i=m.drawings.findIndex(x=>x.id===d.id);if(i>=0){m.drawings.splice(i,1);save();MapV.invalidate()}return}
    case "fog-add":m.fog.shapes.push(d);m.fog.on=true;save();MapV.invalidate();return;
    case "ping":if(live)broadcast({t:"ping",x:d.x,y:d.y,color:GM_COLOR(),name:"GM"});return;
    case "ruler":if(live)broadcast({t:"ruler",by:"gm",name:"GM",color:GM_COLOR(),r:d});return;
    case "tool":setMapTool(d);return;
  }}
function setMapTool(t){MapV.setTool(t);ui.mapTool=t;render()}
function mapAssetUrl(id){return `http://127.0.0.1:${Host.port}/asset/${encodeURIComponent(id)}?k=${encodeURIComponent(Host.key)}`}
function initMapView(){MapV=new MapView({role:"gm",getMap:curMap,canMove:()=>true,canErase:()=>true,onEvent:gmMapEvent,imgUrl:mapAssetUrl,
  me:()=>({color:GM_COLOR(),name:"GM",playerId:"gm"}),ringFor:tokenRing,activeTok:()=>activeTokId(curMap())})}
function afterRender(){
  document.body.classList.toggle("mapmode",ui.tab==="map");
  if(ui.tab==="map"&&MapV){const slot=document.getElementById("map-slot");if(slot&&MapV.el.parentNode!==slot){slot.appendChild(MapV.el);MapV.resize()}MapV.invalidate();scrollLogs()}
}
function hostNavBtn(){const n=Host.conns.size;
  if(Host.status==="online")return `<button class="hostpill on" data-act="open-modal" data-m="host"><span class="dot live"></span>Online · ${n} player${n===1?"":"s"}</button>`;
  if(Host.status==="starting")return `<button class="hostpill" data-act="open-modal" data-m="host"><span class="dot warn"></span>Starting…</button>`;
  return `<button class="hostpill" data-act="open-modal" data-m="host">Host game</button>`}
function viewMap(){
  if(!Desk)return `<div class="wrap" style="padding-block:40px"><div class="empty"><h3>Maps run in the desktop app</h3><p class="muted" style="margin:0">Open this game from the Monolith desktop app to use the battle map and online play.</p></div></div>`;
  const m=curMap();const tool=ui.mapTool||"select";const view=MapV;
  const tools=[toolBtn("select",tool,"select","Select & move (V)"),toolBtn("pan",tool,"pan","Pan (H, or hold Space)"),toolBtn("ruler",tool,"ruler","Measure (R)"),toolBtn("draw",tool,"draw","Draw (D)"),toolBtn("ping",tool,"ping",`Ping (P, or ${IS_MAC?"Option":"Alt"}+click)`),
    `<div class="mtool-sep"></div>`,toolBtn("fog-rect",tool,"fogadd","Hide area with fog (F)"),toolBtn("fog-cut",tool,"fogcut","Reveal area"),toolBtn("fog-poly",tool,"fogpoly","Hide a shape (click points, double-click to finish)"),toolBtn("fog-cutpoly",tool,"fogcutpoly","Reveal a shape"),
    `<div class="mtool-sep"></div>`,`<button class="mtool" data-act="map-zoom" data-v="in" title="Zoom in (+)">${icon("zin")}</button>`,`<button class="mtool" data-act="map-zoom" data-v="out" title="Zoom out (−)">${icon("zout")}</button>`,`<button class="mtool" data-act="map-zoom" data-v="fit" title="Fit map (0)">${icon("fit")}</button>`,
    `<button class="mtool ${view&&view.preview?"on":""}" data-act="map-preview" title="Preview what players see">${icon("eye")}</button>`].join("");
  let sub="";
  if(m&&tool==="draw")sub=inkBar(view);
  else if(m&&tool.startsWith("fog"))sub=`<div class="map-sub"><span class="label" style="color:#a1a4b8">Fog</span><button class="btn sm" data-act="fog-all">Cover whole map</button><button class="btn sm" data-act="fog-undo" ${m.fog.shapes.length?"":"disabled"}>Undo last</button><button class="btn sm" data-act="fog-clear" ${m.fog.shapes.length?"":"disabled"}>${ui.confirm==="fog-clear"?"Confirm: remove all fog":"Remove all fog"}</button><span class="faint" style="font-size:12px;color:#a1a4b8">${tool.includes("poly")?"Click points; click the first point or double-click to finish.":"Drag a box."} Players see fog as solid black.</span></div>`;
  const stage=`<div class="map-stage"><div class="map-slot" id="map-slot" data-keep></div>${sub}${!m?`<div class="map-empty"><h3>No map yet</h3><p>Add a map image (PNG, JPG or WebP), or start with a blank grid.</p><div class="row" style="justify-content:center"><button class="btn primary" data-act="map-add-image">Add map image…</button><button class="btn" data-act="map-add-blank">Blank grid</button></div></div>`:""}</div>`;
  return `<div class="mapwrap"><nav class="map-tools" aria-label="Map tools">${tools}</nav>${stage}${mapResizeHandle()}<aside class="map-side">${mapSide(m)}</aside></div>`;
}
function mapSide(m){
  const n=Host.conns.size;const online=Host.status==="online";
  const players=presence();
  const host=rg("ms-host",`<section class="ms"><div class="row" style="justify-content:space-between"><h3>Table</h3>${online?`<span class="chip green">Online · ${n}</span>`:Host.status==="starting"?`<span class="chip amber">Starting</span>`:`<span class="chip ink">Closed</span>`}</div>
    ${online?`<div class="row"><button class="btn sm primary" data-act="copy-invite">Copy invite code</button><button class="btn sm" data-act="open-modal" data-m="host">Host settings</button></div>`:`<button class="btn primary" data-act="open-modal" data-m="host">Host game…</button>`}
    ${players.length?`<div class="plist">${players.map(p=>`<div class="pl"><span class="dot" style="background:${esc(p.color)}"></span><b>${esc(p.handle||p.name)}</b><span class="faint">${esc(p.name)}</span></div>`).join("")}</div>`:online?`<p class="faint" style="margin:0;font-size:13px">Waiting for players. Send them the invite code.</p>`:""}</section>`);
  const maps=rg("ms-maps",`<section class="ms"><div class="row" style="justify-content:space-between"><h3>Maps</h3><div class="row" style="gap:4px"><button class="btn sm" data-act="map-add-image">+ Image</button><button class="btn sm ghost" data-act="map-add-blank">+ Blank</button></div></div>
    ${(st.maps||[]).length?`<div class="mlist">${st.maps.map(x=>`<div class="mi ${m&&x.id===m.id?"on":""}"><button class="mi-name" data-act="map-view" data-id="${esc(x.id)}">${esc(x.name)}</button>${x.id===st.activeMap?`<span class="chip red">Players see</span>`:`<button class="btn sm ghost" data-act="map-activate" data-id="${esc(x.id)}">Show to players</button>`}<button class="icon-btn mi-del" data-act="map-ask-del" data-id="${esc(x.id)}" aria-label="Delete ${esc(x.name)}" title="Delete this map">${icon("trash")}</button></div>`).join("")}</div>`:`<p class="faint" style="margin:0;font-size:13px">No maps yet.</p>`}</section>`);
  const extra=RS.gm&&RS.gm.mapSideExtra?RS.gm.mapSideExtra(m):"";
  if(!m)return host+extra+maps+tableLogSection();
  const t=ui.mapSel?m.tokens.find(x=>x.id===ui.mapSel):null;
  return host+extra+maps+(t?tokenEditor(m,t):"")+tokensSection(m)+mapSettings(m)+tableLogSection();
}
/* ---------- deleting a map (1.3.3) ---------- */
function mapDelBody(x){const live=Host.status==="online";const isActive=x.id===st.activeMap;const rest=st.maps.filter(y=>y.id!==x.id);const next=isActive?rest[0]:null;
  const pcs=x.tokens.filter(t=>t.kind==="pc").length,npcs=x.tokens.filter(t=>t.kind==="npc").length,marks=x.tokens.length-pcs-npcs;
  const bits=[];if(pcs)bits.push(`${pcs} character token${pcs===1?"":"s"}`);if(npcs)bits.push(`${npcs} NPC token${npcs===1?"":"s"}`);if(marks)bits.push(`${marks} marker${marks===1?"":"s"}`);if(x.drawings.length)bits.push(`${x.drawings.length} drawing${x.drawings.length===1?"":"s"}`);if(x.fog.shapes.length)bits.push("its fog");
  return `<div style="display:grid;gap:14px">
    <div class="delcard"><div class="portrait" style="background:#2a2a2a">${icon("map")}</div><div style="min-width:0"><b class="delname">${esc(x.name)}</b><div class="muted" style="font-size:14px">${x.asset?"Map image":"Blank grid"} · ${Math.round(x.w/(Number(x.grid.size)||70))}×${Math.round(x.h/(Number(x.grid.size)||70))} squares${isActive?" · players see this map":""}</div></div></div>
    <p style="margin:0">This removes the map${bits.length?" along with "+bits.join(", ").replace(/, ([^,]*)$/," and $1"):""}. Characters and the party aren't affected.${isActive?(next?` Players will be switched to <b>${esc(next.name)}</b>${live?" right away":""}.`:` It's the only map, so players won't see a map until you add one.`):""}</p>
    <p class="faint" style="margin:0;font-size:13px">Changed your mind later? Restore <b>Before deleting map "${esc(x.name)}"</b> from Backups → Version history.</p>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="close-modal">Keep it</button><button class="btn danger" id="map-del-go" data-act="map-delete">Delete map</button></div></div>`}
function deleteMap(id){const x=(st.maps||[]).find(y=>y.id===id);if(!x)return;
  snapshot(`Before deleting map "${cleanText(x.name,60)}"`,true);
  const wasActive=st.activeMap===id;const wasViewed=curMap()===x;
  st.maps=st.maps.filter(y=>y.id!==id);
  if(wasActive){st.activeMap=st.maps[0]?.id||null;onActiveMapChanged()}
  if(wasViewed||ui.mapId===id)ui.mapId=st.activeMap||st.maps[0]?.id||null;
  ui.mapSel=null;ui.mapDelId=null;ui.modal=null;ui.confirm=null;
  addLog({kind:"sys",text:`Map "${cleanText(x.name,60)}" deleted.`});
  save(true);if(Host.status==="online")syncNow&&syncNow();render();if(MapV)MapV.fit();
  showNotice(`Deleted "${x.name}".`)}
function tokenEditor(m,t){
  let link="";try{link=RS.gm&&RS.gm.tokenInfo?RS.gm.tokenInfo(t)||"":""}catch(e){}
  if(!link&&t.kind==="pc"){const c=pc(t.ref);if(c)link=`<p class="faint" style="margin:0;font-size:12.5px">${esc(st.players[c.id]||"")}</p>`}
  const owners=Object.entries(st.roster||{});const noun=((RS.gm&&RS.gm.charNoun)||["character"])[0];
  return rg("ms-tok-"+t.id,`<section class="ms tokedit"><div class="row" style="justify-content:space-between"><h3>Token</h3><span class="chip ${t.kind==="pc"?"blue":t.kind==="npc"?"red":"ink"}">${t.kind==="pc"?noun[0].toUpperCase()+noun.slice(1):t.kind==="npc"?"NPC":"Marker"}</span></div>
    <div class="field"><label class="label" for="tk-label">Name</label><input id="tk-label" data-mt="label" value="${esc(t.label||"")}"></div>
    <div class="swatches">${TOKEN_COLORS.map(col=>`<button class="swatch sm ${t.color===col?"on":""}" style="background:${col}" data-act="tk-color" data-v="${col}" aria-label="Color ${col}"></button>`).join("")}</div>
    <div class="row" style="justify-content:space-between"><span class="seg" role="group" aria-label="Size">${[1,2,3,4].map(s=>`<button class="${(t.size||1)===s?"on":""}" data-act="tk-size" data-v="${s}">${s}×${s}</button>`).join("")}</span>
      <label class="row" style="gap:6px;font-size:13.5px"><input type="checkbox" data-act-change="tk-hidden" ${t.hidden?"checked":""}> Hidden from players</label></div>
    ${link}
    ${t.kind!=="npc"?`<div class="field"><label class="label" for="tk-owner">Moved by</label><select id="tk-owner" data-act-change="tk-owner"><option value="">GM only</option>${owners.map(([pid,r])=>`<option value="${esc(pid)}" ${t.owner===pid?"selected":""}>${esc(r.name)}${pc(r.charId)?" ("+esc(charLabel(pc(r.charId)))+")":""}</option>`).join("")}</select></div>`:""}
    <div class="row"><button class="btn sm" data-act="tk-image">${t.img?"Change image":"Set image…"}</button>${t.img?`<button class="btn sm ghost" data-act="tk-noimage">Remove image</button>`:""}<button class="btn sm ghost" data-act="tk-front">Bring to front</button><button class="btn sm danger" data-act="tk-delete">Remove</button></div>
  </section>`)}
function tokensSection(m){
  const extra=RS.gm&&RS.gm.tokenButtons?RS.gm.tokenButtons(m):"";
  return rg("ms-tokens",`<section class="ms"><h3>Tokens · ${m.tokens.length}</h3>
    <div class="row" style="gap:6px"><button class="btn sm" data-act="map-place-party" ${st.party.length?"":"disabled"}>Place party</button>${extra}<button class="btn sm ghost" data-act="map-add-marker">+ Marker</button></div>
    ${m.tokens.length?`<div class="tklist">${m.tokens.slice().reverse().map(t=>`<button class="tk ${ui.mapSel===t.id?"on":""}" data-act="tk-select" data-id="${esc(t.id)}"><span class="dot" style="background:${esc(t.color)}"></span><span>${esc(t.label||"Token")}</span>${t.hidden?`<span class="chip ink">Hidden</span>`:""}${t.kind==="pc"&&t.owner&&[...Host.conns.values()].some(i=>i.playerId===t.owner)?`<span class="chip green">Online</span>`:""}</button>`).join("")}</div>`:""}
  </section>`)}
function mapSettings(m){const g=m.grid;
  return rg("ms-settings",`<details class="ms" ${ui.mapSettingsOpen?"open":""} data-act-toggle="map-settings"><summary><h3 style="display:inline">Map settings</h3></summary>
    <div class="field"><label class="label" for="mm-name">Map name</label><input id="mm-name" data-mm="name" value="${esc(m.name)}"></div>
    <div class="grid2"><div class="field"><label class="label" for="mm-size">Square size (px)</label><input id="mm-size" type="number" min="8" max="400" data-mm="grid.size" value="${esc(g.size)}"></div>
      <div class="field"><label class="label" for="mm-cells">Squares across</label><div class="row" style="flex-wrap:nowrap;gap:4px"><input id="mm-cells" type="number" min="2" max="200" value="${Math.round(m.w/(Number(g.size)||70))}"><button class="btn sm" data-act="mm-fitcells">Set</button></div></div></div>
    <div class="grid2"><div class="field"><label class="label" for="mm-ox">Grid offset X</label><input id="mm-ox" type="number" data-mm="grid.ox" value="${esc(g.ox||0)}"></div><div class="field"><label class="label" for="mm-oy">Grid offset Y</label><input id="mm-oy" type="number" data-mm="grid.oy" value="${esc(g.oy||0)}"></div></div>
    <div class="grid2"><div class="field"><label class="label" for="mm-m">Meters per square</label><input id="mm-m" type="number" min="0.5" step="0.5" data-mm="grid.m" value="${esc(g.m??2)}"></div><div class="field"><label class="label" for="mm-alpha">Grid strength</label><input id="mm-alpha" type="range" min="0.05" max="0.8" step="0.05" data-mm="grid.alpha" value="${esc(g.alpha??0.22)}"></div></div>
    <div class="checks">
      <label><input type="checkbox" data-act-change="mm-bool" data-k="grid.show" ${g.show!==false?"checked":""}> Show grid</label>
      <label><input type="checkbox" data-act-change="mm-bool" data-k="grid.snap" ${g.snap!==false?"checked":""}> Snap tokens to squares</label>
      <label><input type="checkbox" data-act-change="mm-bool" data-k="fog.on" ${m.fog.on?"checked":""}> Fog of war on</label>
      <label><input type="checkbox" data-act-change="host-bool" data-k="playersMove" ${st.host.playersMove!==false?"checked":""}> Players can move their own token</label>
      <label><input type="checkbox" data-act-change="host-bool" data-k="playersDraw" ${st.host.playersDraw!==false?"checked":""}> Players can draw</label>
      <label><input type="checkbox" data-act-change="host-bool" data-k="showNpcHealth" ${st.host.showNpcHealth?"checked":""}> Show NPC health to players</label>
    </div>
    <div class="row"><button class="btn sm ghost" data-act="map-clear-draw" ${m.drawings.length?"":"disabled"}>${ui.confirm==="clear-draw"?"Confirm: clear drawings":"Clear drawings"}</button><button class="btn sm danger" data-act="map-ask-del" data-id="${esc(m.id)}">Delete map…</button></div>
  </details>`)}
function tableLogSection(){
  return `<section class="ms tlog-wrap"><div class="row" style="justify-content:space-between"><h3>Table log</h3><label class="row" style="gap:6px;font-size:12.5px"><input type="checkbox" data-act-change="host-bool" data-k="gmRollsPublic" ${st.host.gmRollsPublic?"checked":""}> My rolls are public</label></div>
    ${rg("tlog",`<div class="tlog">${logHTML(st.tableLog||[],"gm")}</div>`)}
    <div class="row" style="flex-wrap:nowrap"><input id="chat-in" placeholder="Message the table" aria-label="Message the table" ${Host.status==="online"?"":"disabled"}><button class="btn sm" data-act="chat-send" ${Host.status==="online"?"":"disabled"}>Send</button></div></section>`}

function hostModalBody(){
  if(!Desk)return `<p class="muted">Hosting needs the Monolith desktop app.</p>`;
  const err=Host.err?`<div class="banner warnb"><b>Couldn't start.</b> ${esc(Host.err)}</div>`:"";
  const pw=`<div class="field"><label class="label" for="host-pw">Room password</label><div class="row" style="flex-wrap:nowrap"><input id="host-pw" data-host="password" value="${esc(st.host.password)}"><button class="btn sm ghost" data-act="host-newpw">New</button></div><span class="faint" style="font-size:12.5px">It's built into the invite code. Change it to lock out anyone with an old code.</span></div>`;
  if(Host.status==="starting")return `<div style="display:grid;gap:14px"><div class="banner"><span class="dot warn"></span> <b>${esc(Host.tunnelMsg||"Starting…")}</b></div><p class="faint" style="margin:0">This usually takes 5–20 seconds.</p></div>`;
  if(Host.status==="online"){const code=inviteCode();const conns=[...Host.conns.entries()];
    return `<div style="display:grid;gap:16px">${hostCampLine()}
      <div class="banner" style="border-style:solid"><span class="chip green">Online</span> <span>${Host.mode==="online"?"Players anywhere can join with the invite code.":Host.mode==="direct"?`Players connect to <b class="mono">${esc(Host.url)}</b>. Your router must forward TCP port ${Host.directPort} to this PC.`:"Only this computer can join (for testing)."}</span></div>
      <div class="field"><span class="label">Invite code</span><textarea id="invite-code" readonly class="mono" style="min-height:74px;font-size:12px">${esc(code)}</textarea>
        <div class="row"><button class="btn primary" data-act="copy-invite">Copy invite code</button>${Host.mode==="local"?`<button class="btn" data-act="open-player-window">Open a player window</button>`:""}</div>
        <span class="faint" style="font-size:12.5px">Players paste this into <b>Join game</b> in Monolith. ${Host.mode==="online"?"The code changes each time you go online.":""}</span></div>
      ${pw}
      <div><span class="label">At the table · ${conns.length}</span>${conns.length?`<div class="items">${conns.map(([cid,i])=>{const c=pc(i.charId);const k=c?RS.character.card(c):null;return `<div class="it"><div><div class="t"><span class="dot" style="background:${esc(i.color)}"></span> ${esc(i.name)}</div><div class="m">${esc(k?k.name:"")} ${k&&k.sub?"· "+esc(k.sub):""}</div></div><div class="a"><button class="btn sm ghost" data-act="host-kick" data-c="${esc(cid)}" title="Disconnect them for now; they can rejoin with the invite code">Disconnect</button>${c?`<button class="btn sm danger" data-act="ask-remove-pc" data-id="${esc(c.id)}">Remove from party…</button>`:""}</div></div>`}).join("")}</div>`:`<p class="faint" style="margin:4px 0 0">Nobody yet.</p>`}</div>
      ${blockedHTML()}
      <div class="row" style="justify-content:space-between"><span class="faint" style="font-size:12.5px">${Host.mode==="online"?"Link provided free by Cloudflare. Keep Monolith open while you play.":""}</span><button class="btn danger" data-act="host-stop">Stop hosting</button></div>
    </div>`}
  return `<div style="display:grid;gap:14px">${err}${hostCampLine()}
    <div class="hostopt rec"><div><h3>Online <span class="chip green">Recommended</span></h3><p>Creates a private link through Cloudflare, so players anywhere can join with no router setup. The first time, the app downloads Cloudflare's free connector (about 55 MB).</p></div><button class="btn primary" data-act="host-online">Go online</button></div>
    <div class="hostopt"><div><h3>Direct connection</h3><p>For when the online link won't work. Players connect straight to your computer, so your router must forward this TCP port to it${IS_MAC?", and macOS may ask whether to allow incoming connections (choose Allow)":", and Windows will ask you to allow the app through the firewall"}.</p><div class="row"><label class="row" style="gap:6px"><span class="label">Port</span><input id="host-port" type="number" min="1024" max="65535" value="${Host.directPort}" style="width:100px"></label></div></div><button class="btn" data-act="host-direct">Host directly</button></div>
    <div class="hostopt"><div><h3>This computer only</h3><p>Open the table to a player window on this computer. Good for setting up maps and trying things out.</p></div><button class="btn" data-act="host-local">Host locally</button></div>
    ${pw}
  </div>`}

/* ---------- actions ---------- */
const mapFileIn=document.createElement("input");mapFileIn.type="file";mapFileIn.accept="image/png,image/jpeg,image/webp,image/gif";mapFileIn.hidden=true;document.body.appendChild(mapFileIn);
let mapFileFor="map";let mapFileCb=null;
/* pickImage(maxSide, cb(assetId)): for portraits and the like */
function pickImage(maxSide,cb){if(!Host.port){showNotice("The table server isn't running yet. Try again in a moment.");return}mapFileFor={maxSide};mapFileCb=cb;mapFileIn.click()}
mapFileIn.addEventListener("change",async()=>{const f=mapFileIn.files[0];mapFileIn.value="";if(!f)return;
  try{showNotice("Loading image…");const r=await prepareMapImage(f,mapFileFor==="map"?4096:typeof mapFileFor==="object"?mapFileFor.maxSide||512:512);const id=await uploadAsset(r.blob,r.ext);
    if(mapFileFor==="map"){const nm=newMapData({name:cleanText(f.name.replace(/\.[^.]+$/,""),60)||"Map",asset:id,w:r.w,h:r.h,size:clamp(Math.round(r.w/24),24,200)});st.maps.push(nm);ui.mapId=nm.id;if(!st.activeMap)st.activeMap=nm.id;ui.mapSettingsOpen=true;save(true);render();MapV.fit();showNotice("Map added. Line the grid up under Map settings.")}
    else if(typeof mapFileFor==="object"){const cb=mapFileCb;mapFileCb=null;mapFileFor="map";if(cb)cb(id)}
    else{const m=curMap();const t=m&&m.tokens.find(x=>x.id===ui.mapSel);if(t){t.img=id;save();render();MapV.invalidate()}}}
  catch(e){showNotice(e.message||"Couldn't load that image.")}});
async function uploadAsset(blob,ext){const res=await fetch(`http://127.0.0.1:${Host.port}/upload?k=${encodeURIComponent(Host.key)}&ext=${ext}`,{method:"POST",body:blob});if(!res.ok)throw new Error("Couldn't save the image.");return (await res.json()).id}
function selTok(){const m=curMap();return m&&ui.mapSel?m.tokens.find(x=>x.id===ui.mapSel):null}
function onActiveMapChanged(){const m=activeMap();if(m)for(const i of Host.conns.values()){const c=pc(i.charId);if(c)ensurePcToken(m,c,i.playerId)}Host.lastScene=""}
Object.assign(A,{
  "map-tool":el=>setMapTool(el.dataset.t),
  "map-zoom":el=>{const v=el.dataset.v;if(v==="fit")MapV.fit();else MapV.zoomBy(v==="in"?1.25:0.8)},
  "map-preview":()=>{MapV.preview=!MapV.preview;render()},
  "ink-mode":el=>{MapV.drawMode=el.dataset.v;render()},"ink-color":el=>{MapV.inkColor=el.dataset.v;if(MapV.drawMode==="erase")MapV.drawMode="pen";render()},"ink-width":el=>{MapV.inkWidth=Number(el.dataset.v);render()},
  "map-add-image":()=>{if(!Host.port){showNotice("The table server isn't running yet. Try again in a moment.");return}mapFileFor="map";mapFileIn.click()},
  "map-add-blank":()=>{const nm=newMapData({name:"Blank grid "+((st.maps||[]).length+1),w:30*70,h:20*70,size:70});st.maps.push(nm);ui.mapId=nm.id;if(!st.activeMap)st.activeMap=nm.id;save(true);render();MapV.fit()},
  "map-view":el=>{ui.mapId=el.dataset.id;ui.mapSel=null;ui.confirm=null;render()},
  "map-activate":el=>{st.activeMap=el.dataset.id;ui.mapId=el.dataset.id;onActiveMapChanged();save(true);render();if(Host.status==="online")showNotice("Players now see this map.")},
  "map-ask-del":el=>{if(!(st.maps||[]).some(x=>x.id===el.dataset.id))return;ui.mapDelId=el.dataset.id;ui.modal="map-del";renderModal()},
  "map-delete":()=>deleteMap(ui.mapDelId),
  "map-clear-draw":()=>{const m=curMap();if(ui.confirm!=="clear-draw"){ui.confirm="clear-draw";render();return}m.drawings=[];ui.confirm=null;save();render();MapV.invalidate()},
  "mm-fitcells":()=>{const m=curMap();const n=clamp(Number(document.getElementById("mm-cells").value)||0,2,200);if(!n)return;m.grid.size=Math.round(m.w/n*100)/100;save();render();MapV.invalidate()},
  "fog-all":()=>{const m=curMap();m.fog.shapes.push({id:uid(),op:"add",type:"rect",pts:[0,0,m.w,m.h]});m.fog.on=true;save();render();MapV.invalidate()},
  "fog-undo":()=>{const m=curMap();m.fog.shapes.pop();save();render();MapV.invalidate()},
  "fog-clear":()=>{const m=curMap();if(ui.confirm!=="fog-clear"){ui.confirm="fog-clear";render();return}m.fog.shapes=[];ui.confirm=null;save();render();MapV.invalidate()},
  "map-place-party":()=>{const m=curMap();st.party.forEach(c=>{const had=m.tokens.some(t=>t.kind==="pc"&&t.ref===c.id);const t=ensurePcToken(m,c,null);if(!had){const p=freeSpot(m,viewCenter(m).x,viewCenter(m).y);t.x=p.x;t.y=p.y}});save();render();MapV.invalidate()},
  "map-add-marker":()=>{const m=curMap();const c0=viewCenter(m);const p=freeSpot(m,c0.x,c0.y);const t={id:uid(),kind:"marker",label:"Marker",color:"#a76200",size:1,x:p.x,y:p.y,hidden:false,owner:null};m.tokens.push(t);ui.mapSel=t.id;save();render();MapV.invalidate();setTimeout(()=>document.getElementById("tk-label")?.select(),30)},
  "tk-select":el=>{ui.mapSel=el.dataset.id;MapV.sel=el.dataset.id;const t=selTok();if(t){MapV.cam.x=t.x-MapV.cw/2/MapV.cam.z;MapV.cam.y=t.y-MapV.ch/2/MapV.cam.z;MapV.saveCam()}render()},
  "tk-color":el=>{const t=selTok();if(t){t.color=el.dataset.v;save();render();MapV.invalidate()}},
  "tk-size":el=>{const t=selTok();if(t){t.size=Number(el.dataset.v);const m=curMap();if(m.grid.snap!==false){const s=snapPoint(m.grid,t.x,t.y,t.size);t.x=s.x;t.y=s.y}save();render();MapV.invalidate()}},
  "tk-front":()=>{const m=curMap();const i=m.tokens.findIndex(x=>x.id===ui.mapSel);if(i>=0){m.tokens.push(m.tokens.splice(i,1)[0]);save();render();MapV.invalidate()}},
  "tk-delete":()=>gmMapEvent("token-del",ui.mapSel),
  "tk-image":()=>{if(!Host.port){showNotice("The table server isn't running yet. Try again in a moment.");return}mapFileFor="token";mapFileIn.click()},
  "tk-noimage":()=>{const t=selTok();if(t){t.img=null;save();render();MapV.invalidate()}},
  "copy-invite":()=>{const c=inviteCode();if(c)copyText(c,"Invite code copied. Send it to your players.")},
  "open-player-window":()=>Desk&&Desk.openPlayerWindow&&Desk.openPlayerWindow(),
  "host-online":()=>hostOnline(),"host-direct":()=>hostDirect(),"host-local":()=>hostLocal(),"host-stop":()=>hostStop(),
  "host-newpw":()=>{st.host.password=newPassword();pushConfig();save(true);renderModal();if(Host.status==="online")showNotice("New password set. Send players the new invite code.")},
  "host-kick":el=>{const i=Host.conns.get(el.dataset.c);kick(el.dataset.c,"The GM disconnected you. You can rejoin with the invite code.");if(i)showNotice(`Disconnected ${i.name}.`)},
  "ask-remove-pc":el=>{ui.rmId=el.dataset.id;ui.rmTyped="";ui.rmBlock=false;ui.modal="remove-pc";renderModal();setTimeout(()=>document.getElementById("rm-confirm")?.focus(),40)},
  "do-remove-pc":()=>removeFromParty(),
  "unblock":el=>{const pid=el.dataset.pid;st.host.banned=(st.host.banned||[]).filter(x=>x!==pid);if(st.host.bannedNames)delete st.host.bannedNames[pid];save(true);renderModal();render();showNotice("Unblocked. They can join again with the invite code.")},
  "host-ban":el=>{const c=el.dataset.c;if(ui.confirm!=="ban-"+c){ui.confirm="ban-"+c;renderModal();return}const i=Host.conns.get(c);if(i){st.host.banned=[...(st.host.banned||[]),i.playerId];save()}kick(c,"The GM removed you from this table.");ui.confirm=null;renderModal()},
  "chat-send":()=>{const el=document.getElementById("chat-in");const text=cleanText(el&&el.value,500);if(!text)return;el.value="";addLog({kind:"chat",pid:"gm",who:"GM",color:GM_COLOR(),text})},
});
Object.assign(CHANGE,{
  "rm-block":el=>{ui.rmBlock=el.checked},
  "tk-hidden":el=>{const t=selTok();if(t){t.hidden=el.checked;save();render();MapV.invalidate()}},
  "tk-owner":el=>{const t=selTok();if(t){t.owner=el.value||null;save();render()}},
  "mm-bool":el=>{const m=curMap();setPath(m,el.dataset.k,el.checked);save();render();MapV.invalidate()},
  "host-bool":el=>{st.host[el.dataset.k]=el.checked;Host.lastScene="";save();render()},
});
document.addEventListener("input",ev=>{const el=ev.target;
  if(el.dataset.mt){const t=selTok();if(t){t[el.dataset.mt]=cleanText(el.value,40);save();MapV.invalidate()}}
  else if(el.dataset.mm){const m=curMap();if(!m)return;let v=el.type==="number"||el.type==="range"?Number(el.value):el.value;if(el.dataset.mm==="grid.size")v=clamp(v||70,8,400);if(el.dataset.mm==="name")v=cleanText(v,60);setPath(m,el.dataset.mm,v);save();MapV.invalidate()}
  else if(el.dataset.host==="password"){st.host.password=cleanText(el.value,60);pushConfig();save()}
});
document.addEventListener("toggle",ev=>{const el=ev.target;if(el.dataset&&el.dataset.actToggle==="map-settings")ui.mapSettingsOpen=el.open},true);
document.addEventListener("keydown",ev=>{if(ev.key==="Enter"&&ev.target.id==="chat-in"){ev.preventDefault();A["chat-send"]()}});


/* ---------- removing a character from the party ---------- */
function rmNeedle(c){const n=String(charLabel(c)).trim();return n&&n!=="Unnamed"?n:"REMOVE"}
function playersOf(charId){return Object.entries(st.roster||{}).filter(([pid,r])=>r.charId===charId)}
function removePcBody(c){
  const need=rmNeedle(c);const online=isOnline(c.id);const owners=playersOf(c.id);
  const toks=(st.maps||[]).reduce((n,m)=>n+m.tokens.filter(t=>t.kind==="pc"&&t.ref===c.id).length,0);
  const gameLines=RS.gm&&RS.gm.removeNotes?RS.gm.removeNotes(c)||[]:[];const k=RS.character.card(c);
  const who=st.players[c.id]||(owners[0]&&owners[0][1].name)||"";
  const ok=(ui.rmTyped||"").trim().toLowerCase()===need.toLowerCase();
  return `<div style="display:grid;gap:14px">
    <div class="delcard"><div class="portrait" style="background:${esc(k.color||"#2a2a2a")}">${esc(k.initial||"?")}</div>
      <div style="min-width:0"><b class="delname">${esc(k.name)}</b><div class="muted" style="font-size:14px">${esc(k.sub||"")}${who?" · played by "+esc(who):""}${online?` · <span style="color:var(--green)">at the table now</span>`:""}</div></div></div>
    <div><span class="label">What happens</span><ul class="rmlist">
      <li>${esc(k.name)} leaves your party.</li>
      ${toks?`<li>Their token comes off ${toks===1?"the map":toks+" maps"}.</li>`:""}
      ${gameLines.map(x=>`<li>${x}</li>`).join("")}
      ${online?`<li>${esc(who||"The player")} is disconnected from the table.</li>`:""}
      <li>The player keeps their own copy in Monolith.</li>
      <li>A restore point is saved first, so you can undo this from <b>Backups → Version history</b>.</li></ul></div>
    ${owners.length?`<label class="row rmblock" style="gap:8px"><input type="checkbox" id="rm-block" data-act-change="rm-block" ${ui.rmBlock?"checked":""}><span><b>Block ${esc(who||"this player")} from rejoining.</b> If you leave this off and they join again with the invite code, their character rejoins the party.</span></label>`:""}
    <div class="field"><label class="label" for="rm-confirm">To confirm, type <span class="mono" style="color:var(--ink);letter-spacing:.04em">${esc(need)}</span></label>
      <input id="rm-confirm" autocomplete="off" spellcheck="false" data-need="${esc(need.toLowerCase())}" placeholder="${esc(need)}" value="${esc(ui.rmTyped||"")}"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="close-modal">Keep them</button><button class="btn danger" id="rm-go" data-act="do-remove-pc" ${ok?"":"disabled"}>Remove from party</button></div>
  </div>`}
function removeFromParty(){
  const c=pc(ui.rmId);const inp=document.getElementById("rm-confirm");if(!c||!inp)return;
  if(inp.value.trim().toLowerCase()!==rmNeedle(c).toLowerCase()){showNotice("The name you typed doesn't match.");return}
  const block=!!(document.getElementById("rm-block")||{}).checked;const name=charLabel(c);const id=c.id;
  snapshot("Before removing "+name,true);
  for(const [conn,i] of [...Host.conns]){if(i.charId===id){kick(conn,block?"The GM removed you from this table.":`The GM removed your ${((RS.gm&&RS.gm.charNoun)||["character"])[0]} from the party. You can rejoin with the invite code.`);Host.conns.delete(conn);delete Host.charSent[conn]}}
  for(const [pid,r] of playersOf(id)){if(block){st.host.banned=[...new Set([...(st.host.banned||[]),pid])];st.host.bannedNames={...(st.host.bannedNames||{}),[pid]:r.name||name}}delete st.roster[pid]}
  st.party=st.party.filter(x=>x.id!==id);
  (st.maps||[]).forEach(m=>{m.tokens=m.tokens.filter(t=>!(t.kind==="pc"&&t.ref===id))});
  if(RS.gm&&RS.gm.onRemoveCharacter)try{RS.gm.onRemoveCharacter(id)}catch(e){console.error(e)}
  delete st.players[id];
  if(ui.open===id)ui.open=null;if(ui.mapSel&&!(curMap()||{tokens:[]}).tokens.some(t=>t.id===ui.mapSel))ui.mapSel=null;
  ui.modal=null;ui.rmId=null;ui.rmTyped="";
  Host.lastScene="";addLog({kind:"sys",text:`${name} was removed from the party.`});broadcastPresence();
  save(true);render();if(MapV)MapV.invalidate();
  showNotice(`${name} removed from the party${block?" and blocked from rejoining":""}. Undo from Backups → Version history.`);
}
function blockedHTML(){const b=st.host.banned||[];if(!b.length)return "";
  return `<div><span class="label">Blocked from rejoining · ${b.length}</span><div class="items">${b.map(pid=>`<div class="it"><div><div class="t">${esc((st.host.bannedNames||{})[pid]||"A player")}</div></div><div class="a"><button class="btn sm ghost" data-act="unblock" data-pid="${esc(pid)}">Unblock</button></div></div>`).join("")}</div></div>`}
document.addEventListener("input",ev=>{const el=ev.target;if(el.id==="rm-confirm"){ui.rmTyped=el.value;const b=document.getElementById("rm-go");if(b)b.disabled=el.value.trim().toLowerCase()!==el.dataset.need}});
document.addEventListener("keydown",ev=>{if(ev.key==="Enter"&&ev.target.id==="rm-confirm"){ev.preventDefault();const b=document.getElementById("rm-go");if(b&&!b.disabled)removeFromParty()}});


