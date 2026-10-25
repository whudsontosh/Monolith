/* A minimal game: a character is a name and two stats; one roll. It exists to prove the core
   works without Cyberpunk, and that every optional part of the game contract is optional. */
"use strict";
function tgBlank(){return {id:uid(),name:"",might:2,wits:2,hurt:0,done:false,createdAt:Date.now(),updatedAt:Date.now()}}
function tgNormalize(x){const c={...tgBlank(),...clone(x)};c.might=clamp(Number(c.might)||0,0,10);c.wits=clamp(Number(c.wits)||0,0,10);c.hurt=clamp(Number(c.hurt)||0,0,10);return c}
function tgEdit(c){const ed=canEditChar(c);return `<div class="roster-head"><h1><small>Test Game</small>${esc(c.name||"Unnamed")}</h1></div>
  <section class="panel"><div class="panel-b" style="display:grid;gap:12px">
    <div class="field"><label class="label" for="tg-name">Name</label><input id="tg-name" data-tg="name" value="${esc(c.name)}" ${ed?"":"disabled"}></div>
    <div class="row"><span class="label">Might</span><b id="tg-might">${c.might}</b><button class="btn sm" data-act="tg-roll" data-s="might">Roll might</button>
      <span class="label">Wits</span><b>${c.wits}</b><button class="btn sm" data-act="tg-roll" data-s="wits">Roll wits</button></div>
    <div class="row"><button class="btn primary" data-act="tg-done">${c.done?"Finished":"Finish"}</button></div>
  </div></section>`}
A["tg-roll"]=el=>{const c=curChar()||myChar();if(!c)return;const v=c[el.dataset.s];const r=d(6);const t=v+r;Dice.raw(el.dataset.s,`${v} + D6 (${r})`,t,c.name,[t>=6?{t:"Success",c:"green"}:{t:"Miss",c:"red"}])};
A["tg-done"]=()=>{const c=curChar();if(!c||!canEditChar(c))return;c.done=true;saveChar(c,true);render()};
document.addEventListener("input",ev=>{const el=ev.target;if(el.dataset.tg){const c=curChar();if(c&&canEditChar(c)){c[el.dataset.tg]=el.value;saveChar(c)}}});
Monolith.registerGame({
  id:"testgame",api:1,
  rulesets:{basic:{name:"Basic",
    character:{blank:tgBlank,normalize:tgNormalize,isCharacter:x=>!!(x&&typeof x==="object"&&"might" in x),isFinished:c=>!!c.done,joined:c=>{c.done=true},
      label:c=>c.name||"Unnamed",card:c=>({name:c.name||"Unnamed",sub:`Might ${c.might} · Wits ${c.wits}`,color:"#556070",initial:(c.name||"?").charAt(0).toUpperCase(),chips:c.done?[]:[{t:"Draft",c:"blue"}]})},
    player:{views:{edit:c=>tgEdit(c)},openView:()=>"edit"},
  }},
});
