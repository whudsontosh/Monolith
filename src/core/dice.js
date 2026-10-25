/* ============================== MONOLITH CORE: DICE ==============================
   The dice tray and roll log. A roll entry is {who,label,detail,total,tags,t}. Tags are the
   game's verdict chips ({t:"Beats DV 15",c:"green"}); the core only shows them.
   Games add their own roll types on top (Monolith.hooks.trayQuick, trayRoll, Tray.extra). */
const TAG_TONES=["green","red","amber","blue","ink"];
function cleanTags(tags){return (Array.isArray(tags)?tags:[]).slice(0,4).map(x=>({t:cleanText(x&&x.t,40),c:TAG_TONES.includes(x&&x.c)?x.c:"ink"})).filter(x=>x.t)}
function rollTags(e){return cleanTags(e&&e.tags).map(x=>`<span class="chip ${x.c}">${esc(x.t)}</span>`).join(" ")}
const Dice={log:[],key:"",who:()=>"",
  init(key,who){this.key=key;this.who=who;this.log=LS.get(key,[])||[]},
  push(e){e.tags=cleanTags(e.tags);this.log.unshift(e);this.log=this.log.slice(0,60);LS.set(this.key,this.log.slice(0,40));showToast(e);Tray.render()},
  expr(label,expr,bonus=0,who){const r=rollDice(expr);if(!r){showNotice(`"${expr}" isn't a dice expression. Try 2D6+3.`);return null}
    const e={who:who||this.who(),label,detail:`${expr}${bonus?" "+sgn(bonus):""} → ${r.text}${bonus?" "+sgn(bonus):""}`,total:Math.max(0,r.total+bonus),t:Date.now()};this.push(e);return e},
  raw(label,detail,total,who,tags){const e={who:who||this.who(),label,detail,total,tags:tags||[],t:Date.now()};this.push(e);return e}
};
const Tray={open:false,
  quick(){return (Monolith.hooks.trayQuick&&Monolith.hooks.trayQuick())||[["1D4","1D4"],["1D6","1D6"],["1D8","1D8"],["1D10","1D10"],["1D12","1D12"],["1D20","1D20"],["2D6","2D6"]]},
  render(){const host=document.getElementById("tray-host");if(!host)return;if(!this.open){host.innerHTML="";return}
    const L=Dice.log;const prev=document.getElementById("tray-expr");const keep=prev?prev.value:(this.lastExpr||"");const focused=prev&&document.activeElement===prev;
    host.innerHTML=`<div class="tray" role="dialog" aria-label="Dice tray">
    <div class="tray-b"><div class="row" style="justify-content:space-between"><b class="tray-title">Dice</b><button class="btn sm ghost" data-act="tray-clear">Clear log</button></div>
      ${this.extra?this.extra():""}<div class="row" style="gap:6px">${this.quick().map(([l,e])=>`<button class="btn sm" data-act="quick-roll" data-e="${esc(e)}">${esc(l)}</button>`).join("")}</div>
      <div class="row" style="flex-wrap:nowrap"><input id="tray-expr" placeholder="e.g. 4D6+1" aria-label="Dice expression" value="${esc(keep)}"><button class="btn primary" data-act="tray-roll">Roll</button></div></div>
    <div class="tray-log">${L.length?L.slice(0,40).map(r=>`<div class="rl"><div style="min-width:0"><div class="who">${esc(r.who)}</div><div class="lbl">${esc(r.label)}</div><div class="det">${esc(r.detail)}</div>${rollTags(r)}</div><div class="tot num">${esc(r.total)}</div></div>`).join(""):`<p class="faint" style="font-size:13px">Rolls land here.</p>`}</div>
  </div>`;if(focused){const n=document.getElementById("tray-expr");if(n){n.focus();n.select()}}}
};
function trayRoll(v){if(Monolith.hooks.trayRoll&&Monolith.hooks.trayRoll(v))return;Dice.expr(v.toUpperCase(),v)}
Object.assign(A,{
  "toggle-tray":()=>{Tray.open=!Tray.open;Tray.render()},
  "quick-roll":el=>trayRoll(el.dataset.e),
  "tray-roll":()=>{const el=document.getElementById("tray-expr");const v=(el&&el.value||"").trim();if(!v)return;Tray.lastExpr=v;trayRoll(v)},
  "tray-clear":()=>{Dice.log=[];LS.set(Dice.key,[]);Tray.render()},
});
