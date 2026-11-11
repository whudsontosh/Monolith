/* ============================== MONOLITH CORE: TABLE UI ==============================
   Invite codes, the table log, drawing bar and the resizable map sidebar. */
function makeInvite(u,p,n,g){return "MON1."+b64e(JSON.stringify({u:String(u).replace(/\/+$/,""),p,n,g}))}
function readInvite(code){code=String(code||"").trim().replace(/\s+/g,"");const m=code.match(/MON1\.([A-Za-z0-9_-]+)/);if(!m)return null;
  try{const j=JSON.parse(b64d(m[1]));if(!/^https?:\/\/[^\s/]+/.test(j.u||""))return null;return {u:j.u.replace(/\/+$/,""),p:String(j.p||""),n:String(j.n||""),g:String(j.g||"").replace(/[^a-z0-9-]/g,"").slice(0,40)}}catch(e){return null}}
function toolBtn(t,cur,ic,title){return `<button class="mtool ${cur===t?"on":""}" data-act="map-tool" data-t="${t}" title="${esc(title)}" aria-label="${esc(title)}" aria-pressed="${cur===t}">${icon(ic)}</button>`}
function inkBar(view,allowErase=true){
  return `<div class="map-sub" role="toolbar" aria-label="Drawing">
    <span class="seg">${[["pen","Pen"],["line","Line"],["rect","Box"]].concat(allowErase?[["erase","Eraser"]]:[]).map(([k,l])=>`<button class="${view.drawMode===k?"on":""}" data-act="ink-mode" data-v="${k}">${l}</button>`).join("")}</span>
    <span class="inks">${INK_COLORS.map(c=>`<button class="inkdot ${view.inkColor===c?"on":""}" style="background:${c}" data-act="ink-color" data-v="${c}" aria-label="Color ${c}"></button>`).join("")}</span>
    <span class="seg">${[[2,"Thin"],[4,"Med"],[8,"Thick"]].map(([w,l])=>`<button class="${view.inkWidth===w?"on":""}" data-act="ink-width" data-v="${w}">${l}</button>`).join("")}</span>
  </div>`}
/* the bar under the Template tool: shape, the game's ready-made templates, color, and the selected one */
function tableMapView(){return ROLE==="gm"?MapV:PMapV}
function tplBar(view,m,isGm){const g=m.grid,pre=Tpl.presets(g),sel=(m.templates||[]).find(t=>t.id===view.tplSel),can=sel&&view.canTpl(sel),free=!view.tplPreset;
  const names=sel?Tpl.caught(sel,g,(m.tokens||[]).filter(t=>isGm||!t.hidden)).map(t=>t.label||"Token"):[];
  return `<div class="map-sub" role="toolbar" aria-label="Area templates">
    <span class="seg">${[["circle","Circle"],["cone","Cone"],["line","Line"],["square","Square"]].map(([k,l])=>`<button class="${free&&view.tplShape===k?"on":""}" data-act="tpl-shape" data-v="${k}">${l}</button>`).join("")}</span>
    ${pre.length?`<select data-act-change="tpl-preset" aria-label="Ready-made templates" style="width:auto;min-height:0;padding:4px 8px"><option value="">Ready-made…</option>${pre.map(p=>`<option value="${esc(p.id)}" ${view.tplPreset===p.id?"selected":""}>${esc(p.name)} (${esc(Tpl.describe({shape:p.shape,size:p.size,width:p.width,label:""},g).toLowerCase())})</option>`).join("")}</select>`:""}
    ${free&&view.tplShape==="line"?`<label class="faint" style="font-size:12px;color:#a1a4b8;display:flex;align-items:center;gap:5px">Width <input type="number" min="0.5" step="0.5" value="${esc(Math.round(view.tplWidth*Grid.per(g)*100)/100)}" data-act-change="tpl-width" style="width:4.6em;min-height:0;padding:3px 6px" aria-label="Line width in ${esc(Grid.unit(g))}"> ${esc(Grid.unit(g))}</label>`:""}
    <span class="inks">${INK_COLORS.map(c=>`<button class="inkdot ${view.tplColor===c?"on":""}" style="background:${c}" data-act="tpl-color" data-v="${c}" aria-label="Color ${c}"></button>`).join("")}</span>
    ${sel?`<span style="font-size:12px;color:#eef0f6">${esc(Tpl.describe(sel,g))}${names.length?`: ${esc(names.slice(0,8).join(", "))}${names.length>8?"…":""}`:": nobody caught"}</span><button class="btn sm" data-act="tpl-del" ${can?"":"disabled"}>Remove</button>`
      :`<span class="faint" style="font-size:12px;color:#a1a4b8">Drag on the map to place one. Drag its dot to move it, its square to turn or resize it.</span>`}
    ${isGm&&(m.templates||[]).length?`<button class="btn sm" data-act="tpl-clear">Clear all</button>`:""}
  </div>`}
Object.assign(A,{
  "tpl-shape":el=>{const v=tableMapView();v.tplShape=el.dataset.v;v.tplPreset="";render()},
  "tpl-color":el=>{const v=tableMapView();v.tplColor=el.dataset.v;render()},
  "tpl-del":()=>{const v=tableMapView();if(v.tplSel){const id=v.tplSel;v.tplSel=null;v.emit("tpl-del",id)}},
});
Object.assign(CHANGE,{
  "tpl-preset":el=>{const v=tableMapView();v.tplPreset=el.value;render()},
  "tpl-width":el=>{const v=tableMapView(),m=v.map;v.tplWidth=Math.max(.25,(Number(el.value)||0)/Grid.per(m&&m.grid))||1},
});
function logHTML(list,myPid){
  if(!list.length)return `<p class="faint" style="margin:0;font-size:13px">Rolls, chat and who joined show up here.</p>`;
  return list.slice(-80).map(e=>{
    const who=`<b style="color:${esc(e.color||"var(--ink)")}">${esc(e.who||"")}</b>`;
    if(e.kind==="roll")return `<div class="tl roll"><div style="min-width:0">${who} <span class="faint">rolled</span> ${esc(e.label||"")}<div class="det mono">${esc(e.detail||"")}</div>${rollTags(e)}</div><span class="tot num">${esc(e.total)}</span></div>`;
    if(e.kind==="chat")return `<div class="tl chat">${who} <span>${esc(e.text||"")}</span></div>`;
    return `<div class="tl sys">${esc(e.text||"")}</div>`}).join("");
}
function scrollLogs(){document.querySelectorAll(".tlog").forEach(el=>{if(el.dataset.stick!=="0")el.scrollTop=el.scrollHeight})}
document.addEventListener("scroll",ev=>{const el=ev.target;if(el.classList&&el.classList.contains("tlog"))el.dataset.stick=(el.scrollHeight-el.scrollTop-el.clientHeight<30)?"1":"0"},true);
/* ---------- map sidebar width (1.3.3): drag the sidebar's left edge; remembered on this computer ---------- */
const SIDE_KEY="monolith-map-side-w",SIDE_DEF=420,SIDE_MIN=300;
function sideMax(){return Math.max(SIDE_MIN,Math.min(900,Math.round(window.innerWidth*0.6)))}
function sideStored(){try{return Number(localStorage.getItem(SIDE_KEY))||SIDE_DEF}catch(e){return SIDE_DEF}}
function setSideW(w,keep){w=Math.round(Math.min(sideMax(),Math.max(SIDE_MIN,Number(w)||SIDE_DEF)));document.documentElement.style.setProperty("--map-side-w",w+"px");
  if(keep)try{localStorage.setItem(SIDE_KEY,String(w))}catch(e){}
  document.querySelectorAll(".map-resize").forEach(h=>{h.setAttribute("aria-valuenow",String(w));h.setAttribute("aria-valuemax",String(sideMax()))});return w}
function mapResizeHandle(){const w=Math.min(sideMax(),sideStored());return `<div class="map-resize" role="separator" aria-orientation="vertical" aria-label="Sidebar width. Drag, or use the arrow keys. Double-click to reset." title="Drag to resize the sidebar (double-click to reset)" tabindex="0" aria-valuemin="${SIDE_MIN}" aria-valuemax="${sideMax()}" aria-valuenow="${w}"></div>`}
setSideW(sideStored());
window.addEventListener("resize",()=>setSideW(sideStored()));
document.addEventListener("pointerdown",ev=>{const h=ev.target.closest&&ev.target.closest(".map-resize");if(!h||ev.button!==0)return;
  const side=h.parentElement&&h.parentElement.querySelector(".map-side");if(!side)return;ev.preventDefault();
  const x0=ev.clientX,w0=side.getBoundingClientRect().width;let w=w0;try{h.setPointerCapture(ev.pointerId)}catch(e){}document.body.classList.add("side-resizing");
  const move=e=>{w=setSideW(w0+(x0-e.clientX))};
  const up=()=>{h.removeEventListener("pointermove",move);h.removeEventListener("pointerup",up);h.removeEventListener("pointercancel",up);document.body.classList.remove("side-resizing");setSideW(w,true)};
  h.addEventListener("pointermove",move);h.addEventListener("pointerup",up);h.addEventListener("pointercancel",up)});
document.addEventListener("dblclick",ev=>{if(ev.target.closest&&ev.target.closest(".map-resize"))setSideW(SIDE_DEF,true)});
document.addEventListener("keydown",ev=>{const h=ev.target;if(!h.classList||!h.classList.contains("map-resize"))return;
  const cur=sideStored();let w=null;if(ev.key==="ArrowLeft")w=cur+30;else if(ev.key==="ArrowRight")w=cur-30;else if(ev.key==="Home")w=SIDE_MIN;else if(ev.key==="End")w=sideMax();else if(ev.key==="Enter")w=SIDE_DEF;
  if(w!=null){ev.preventDefault();ev.stopPropagation();setSideW(w,true)}},true);
