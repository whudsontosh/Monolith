/* ============================== GM: MAP EXTRAS ==============================
   The GM's side of what the map gained after 1.1: area templates (1.3). The GM's app is the only
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
/* for games: place and read templates on the map the GM is looking at. Sizes are in the map's units (ft, m). */
Monolith.map={
  addTemplate(o){const m=curMap();if(!m||!o)return null;const per=Grid.per(m.grid);
    const t=Tpl.clean({...o,id:"",size:(Number(o.size)||per)/per,width:(Number(o.width)||per)/per},m);if(!t)return null;t.by="gm";if(o.fixed!==false)t.fixed=true;
    const L=tplList(m);if(L.length>=80)L.shift();L.push(t);tplAfter(m);tplTell(m,t);return t.id},
  removeTemplate(id){const m=curMap();if(!m)return false;const L=tplList(m),i=L.findIndex(x=>x.id===id);if(i<0)return false;L.splice(i,1);tplAfter(m);return true},
  templates(){const m=curMap();return m?tplList(m).map(t=>({...t})):[]},
  caught(id){const m=curMap();if(!m)return [];const t=tplList(m).find(x=>x.id===id);return t?Tpl.caught(t,m.grid,m.tokens||[]):[]},
};
