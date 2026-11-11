/* ============================== MONOLITH CORE: TOKEN STATES ==============================
   What a token can carry besides its place on the map (1.4):
     conds  [{id, rounds}]            status badges; rounds counts down when the game ends a round
     elev   number                    height above the ground, in the map's units (ft, m)
     auras  [{r, color, see}]         rings that move with the token; r in the map's units,
                                      see "all" | "owner" | "gm"

   The core draws and stores them. A game says what they mean by registering, all optional:
     map:{
       conditions:[{id:"stunned", name:"Stunned", color:"#f2a93b", icon:"M12 3l2.5 6.5..."}],
            // icon: SVG path data for a 24×24 box, drawn as a white line. Only path commands
            // and numbers are accepted; without one the badge shows the name's first letters.
       auraFrom:"edge",   // auras are measured from the token's "edge" (default) or its "centre"
     }
   A game ends a round with Monolith.map.endRound() on the GM's side (map_host.js). */
const Cond=(()=>{
  const DEFAULTS=[
    {id:"down",name:"Down",color:"#ff4459",icon:"M6 6L18 18M18 6L6 18"},
    {id:"stunned",name:"Stunned",color:"#f2a93b",icon:"M12 3.5l2.4 5.6 6.1.5-4.6 4 1.4 6-5.3-3.2-5.3 3.2 1.4-6-4.6-4 6.1-.5z"},
    {id:"prone",name:"Prone",color:"#7d95ff",icon:"M12 4v11M7 10.5l5 5 5-5M4 20h16"},
    {id:"hidden",name:"Hiding",color:"#8b8f9c",icon:"M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM4.5 4.5l15 15"},
    {id:"marked",name:"Marked",color:"#c77dff",icon:"M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"},
  ];
  const HEX=/^#[0-9a-fA-F]{6}$/,ICON=/^[MmLlHhVvCcSsQqTtAaZz0-9\s,.\-+eE]{1,900}$/;
  let memo=null,memoSrc=null;
  /* the game's list, cleaned; or the small default set */
  function list(){const src=(typeof GAME!=="undefined"&&GAME&&GAME.map&&GAME.map.conditions)||null;if(memo&&memoSrc===src)return memo;
    const out=[],seen=new Set();
    for(const c of Array.isArray(src)?src.slice(0,60):[]){if(!c)continue;const id=String(c.id||"").replace(/[^A-Za-z0-9_-]/g,"").slice(0,30);if(!id||seen.has(id))continue;seen.add(id);
      out.push({id,name:cleanText(c.name||id,30),color:HEX.test(c.color||"")?c.color:"#8b8f9c",icon:typeof c.icon==="string"&&ICON.test(c.icon)?c.icon:""})}
    memoSrc=src;memo=out.length?out:DEFAULTS;return memo}
  const get=id=>list().find(c=>c.id===id)||null;
  function cleanConds(L){const out=[],seen=new Set();for(const e of Array.isArray(L)?L:[]){if(!e||!get(e.id)||seen.has(e.id))continue;seen.add(e.id);
      const r=Math.floor(Number(e.rounds)),o={id:e.id};if(r>=1)o.rounds=Math.min(r,999);out.push(o);if(out.length>=16)break}return out}
  const cleanElev=v=>{v=Math.round(Number(v)*10)/10;return isFinite(v)?Math.max(-99999,Math.min(99999,v)):0};
  function cleanAuras(L){const out=[];for(const a of Array.isArray(L)?L:[]){if(!a)continue;const r=Number(a.r);if(!(r>0)||!isFinite(r))continue;
      out.push({r:Math.min(100000,Math.round(r*100)/100),color:HEX.test(a.color||"")?a.color:"#f2a93b",see:["all","owner","gm"].includes(a.see)?a.see:"all"});if(out.length>=3)break}return out}
  /* apply a change to a token: {cond:{id,on,rounds}} | {elev} | {auras}. Returns true if anything was accepted. */
  function apply(t,p){if(!t||!p||typeof p!=="object")return false;let did=false;
    if(p.cond&&get(p.cond.id)){const L=cleanConds(t.conds),i=L.findIndex(x=>x.id===p.cond.id);
      if(p.cond.on===false){if(i>=0)L.splice(i,1)}else{const e=cleanConds([{id:p.cond.id,rounds:p.cond.rounds}])[0];if(i>=0)L[i]=e;else L.push(e)}
      if(L.length)t.conds=cleanConds(L);else delete t.conds;did=true}
    if("elev" in p){const v=cleanElev(p.elev);if(v)t.elev=v;else delete t.elev;did=true}
    if("auras" in p){const a=cleanAuras(p.auras);if(a.length)t.auras=a;else delete t.auras;did=true}
    return did}
  /* "Stunned (2 rounds), Prone" */
  const describe=t=>cleanConds(t&&t.conds).map(e=>get(e.id).name+(e.rounds?` (${e.rounds} round${e.rounds===1?"":"s"})`:"")).join(", ");
  const paths=new Map();
  const path=c=>{if(!c.icon||typeof Path2D==="undefined")return null;if(!paths.has(c.icon)){let p=null;try{p=new Path2D(c.icon)}catch(e){}paths.set(c.icon,p)}return paths.get(c.icon)};
  const svg=c=>c.icon?`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${esc(c.icon)}"/></svg>`:"";
  /* an aura's reach in map pixels */
  function auraR(g,t,a){const from=(typeof GAME!=="undefined"&&GAME&&GAME.map&&GAME.map.auraFrom)==="centre"?0:Grid.tokR(g,t.size);return from+a.r/Grid.per(g)*Grid.size(g)}
  /* the other tokens an aura reaches, by the game's rule for who is inside */
  function auraCatches(g,t,a,tokens){const tpl={shape:"circle",x:t.x,y:t.y,size:auraR(g,t,a)/Grid.size(g),width:1,angle:0};return (tokens||[]).filter(k=>k.id!==t.id&&Tpl.catches(tpl,g,k))}
  return {list,get,cleanConds,cleanElev,cleanAuras,apply,describe,path,svg,auraR,auraCatches};
})();
/* the controls for one token's conditions and height: in the GM's token panel and in the right-click menu */
function tokStateHTML(t,g){const on=Cond.cleanConds(t.conds),id=esc(t.id);
  return `<div class="tks"><div class="tks-c">${Cond.list().map(c=>{const e=on.find(x=>x.id===c.id);
      return `<span class="tks-i ${e?"on":""}"><button data-act="tk-cond" data-id="${id}" data-c="${esc(c.id)}" aria-pressed="${e?"true":"false"}" title="${esc(c.name)}"><i style="background:${esc(c.color)}">${Cond.svg(c)||esc(c.name.slice(0,2))}</i>${esc(c.name)}</button>${e?`<input type="number" min="1" max="999" placeholder="∞" value="${e.rounds||""}" data-act-change="tk-cond-rounds" data-id="${id}" data-c="${esc(c.id)}" title="Rounds left (empty: until removed)" aria-label="${esc(c.name)}: rounds left">`:""}</span>`}).join("")}</div>
    <label class="tks-e">Height <input type="number" step="any" value="${t.elev||""}" placeholder="0" data-act-change="tk-elev" data-id="${id}" aria-label="Height in ${esc(Grid.unit(g))}"> ${esc(Grid.unit(g))}</label></div>`}
/* the right-click menu for a token; pos is where it was clicked, in map-stage pixels */
function tokMenuHTML(t,g,pos){if(!t||!pos)return "";
  return `<div class="tokmenu" role="dialog" aria-label="${esc(t.label||"Token")}" style="left:min(${Math.round(pos.x)}px,calc(100% - 350px));top:min(${Math.round(pos.y)}px,calc(100% - 280px))"><div class="row" style="justify-content:space-between;gap:10px"><b>${esc(t.label||"Token")}</b><button class="btn sm ghost" data-act="tk-menu-close" aria-label="Close">×</button></div>${tokStateHTML(t,g)}</div>`}
/* both sides route changes through tokPatch(id, change): the GM applies them, a player asks the GM */
Object.assign(A,{
  "tk-cond":el=>tokPatch(el.dataset.id,{cond:{id:el.dataset.c,on:el.getAttribute("aria-pressed")!=="true"}}),
  "tk-menu-close":()=>{ui.tokMenu=null;render()},
});
Object.assign(CHANGE,{
  "tk-cond-rounds":el=>tokPatch(el.dataset.id,{cond:{id:el.dataset.c,on:true,rounds:Number(el.value)||0}}),
  "tk-elev":el=>tokPatch(el.dataset.id,{elev:Number(el.value)||0}),
});
