/* ============================== GM: MAP EXTRAS ==============================
   The GM's side of what the map gained after 1.1: area templates (1.3), and token conditions,
   height and auras (1.4). The GM's app is the only
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
  return `<div class="field"><span class="label">Conditions and height</span>${tokStateHTML(t,g)}</div>
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
