/* ============================== MONOLITH CORE: UI KIT ==============================
   Patch the DOM instead of rebuilding it: unchanged nodes stay put, focus and scroll survive.
   Regions: rg(key,html) marks a panel. On redraw a panel whose HTML is unchanged is skipped.
   Registries: A (data-act clicks), CHANGE (data-act-change), MODALS (ui.modal names). */
const RG={pending:[],cache:new WeakMap()};
function rg(key,html){key=String(key).replace(/[^a-z0-9_-]/gi,"_");RG.pending.push([key,html]);return `<div class="rg" data-rg="${key}"></div>`}
const MORPH_OPTS={
  onBeforeElUpdated(from,to){
    if(from.isEqualNode(to))return false;
    // a node changing into (or out of) a different panel must not reuse that panel's cached HTML
    if((from.dataset&&from.dataset.rg||"")!==(to.dataset&&to.dataset.rg||""))RG.cache.delete(from);
    if(from===document.activeElement&&(from.tagName==="TEXTAREA"||from.tagName==="SELECT"||(from.tagName==="INPUT"&&from.type!=="checkbox"&&from.type!=="radio")))return false;
    return true},
  onBeforeElChildrenUpdated(from){return !(from.dataset&&(from.dataset.rg||from.dataset.keep!==undefined))}};
function patch(el,html){
  const pending=RG.pending;RG.pending=[];
  if(typeof morphdom!=="function"){el.innerHTML=html;fillRegions(el,pending,true);return}
  morphdom(el,"<div>"+html+"</div>",{childrenOnly:true,...MORPH_OPTS});
  fillRegions(el,pending,false);
}
function fillRegions(root,pending,plain){
  // outer regions were registered after their inner ones, so walk backwards
  for(let i=pending.length-1;i>=0;i--){const [key,html]=pending[i];
    const node=root.querySelector(`[data-rg="${key}"]`);if(!node)continue;
    if(RG.cache.get(node)===html)continue;
    if(plain||!node.firstChild)node.innerHTML=html;
    else morphdom(node,"<div>"+html+"</div>",{childrenOnly:true,...MORPH_OPTS});
    RG.cache.set(node,html)}
}

/* ---------- registries & state ---------- */
const ui={modal:null,confirm:null};
const A={};
const CHANGE={};
const MODALS={};   // name -> () => ({title, body, wide}) | null
const app=document.getElementById("app");
let rq=0;
function requestRender(){if(rq)return;rq=requestAnimationFrame(()=>{rq=0;render()})}

/* games run their own bookkeeping before each draw (for example, switching rule packs) */
const BEFORE_RENDER=[];
function runBeforeRender(){BEFORE_RENDER.forEach(f=>{try{f()}catch(e){console.error(e)}})}
function renderModal(){
  const host=document.getElementById("modal-host");if(!host)return;const m=ui.modal;if(!m){host.innerHTML="";return}
  runBeforeRender();
  const def=MODALS[m];let r=null;try{r=def?def():null}catch(e){console.error(e);r=null}
  if(!r){ui.modal=null;host.innerHTML="";return}
  patch(host,`<div class="scrim" data-act="close-modal-bg"><div class="modal${r.wide?" wide":""}" role="dialog" aria-modal="true" aria-label="${esc(r.title)}"><div class="modal-h"><h2>${esc(r.title)}</h2><button class="icon-btn" data-act="close-modal" aria-label="Close">×</button></div><div class="modal-b">${r.body}</div></div></div>`);
}
function openModal(name){ui.modal=name;renderModal()}
function closeModal(){ui.modal=null;renderModal()}

/* ---------- toasts ---------- */
let toastT=null;
function showToast(e){
  const host=document.getElementById("toast-host");if(!host)return;
  host.innerHTML=`<div class="toast" role="status"><div class="tot num">${esc(e.total)}</div><div><div class="lbl">${esc(e.who)} · ${esc(e.label)}</div><div class="det">${esc(e.detail)}</div>${rollTags(e)}</div></div>`;
  clearTimeout(toastT);toastT=setTimeout(()=>host.innerHTML="",4200);
}
function showNotice(text){const host=document.getElementById("toast-host");if(!host)return;host.innerHTML=`<div class="toast" role="status"><div><div class="lbl">${esc(text)}</div></div></div>`;clearTimeout(toastT);toastT=setTimeout(()=>host.innerHTML="",4500)}
function setStatusText(t,cls){const el=document.getElementById("status");if(el)el.innerHTML=`<span class="dot ${cls||""}"></span><span>${esc(t)}</span>`}

/* ---------- icons ---------- */
const ICONS={
  select:'<path d="M6 3.5l11.5 9-5.2 1.2-2.6 5.3z"/>',
  pan:'<path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
  ruler:'<path d="M3.5 16.5L16.5 3.5l4 4-13 13z"/><path d="M7.5 12.5l2 2M10.5 9.5l2 2M13.5 6.5l2 2"/>',
  draw:'<path d="M4 20l4.2-1L19 8.2 15.8 5 5 15.8z"/><path d="M13.8 7l3.2 3.2"/>',
  fogadd:'<path d="M7 17h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.4 1.6A3.3 3.3 0 0 0 7 17z" fill="currentColor" fill-opacity=".35"/>',
  fogcut:'<rect x="4" y="5" width="16" height="14" stroke-dasharray="3 2.5"/><path d="M9 12l2 2 4-4"/>',
  fogpoly:'<path d="M5 7l7-3 7 5-2 10H7z" fill="currentColor" fill-opacity=".35"/>',
  fogcutpoly:'<path d="M5 7l7-3 7 5-2 10H7z" stroke-dasharray="3 2.5"/>',
  ping:'<circle cx="12" cy="12" r="2.6" fill="currentColor"/><circle cx="12" cy="12" r="7.5"/>',
  zin:'<circle cx="11" cy="11" r="6.5"/><path d="M11 8v6M8 11h6M16 16l4 4"/>',
  zout:'<circle cx="11" cy="11" r="6.5"/><path d="M8 11h6M16 16l4 4"/>',
  fit:'<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  trash:'<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10 10v6.5M14 10v6.5"/>',
  map:'<path d="M3.5 6l5.5-2 6 2 5.5-2v14l-5.5 2-6-2-5.5 2z"/><path d="M9 4v14M15 6v14"/>',
  eye:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  back:'<path d="M14.5 5.5L8 12l6.5 6.5"/>',
};
function icon(n){return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]||""}</svg>`}
function copyText(text,okMsg){const done=()=>showNotice(okMsg||"Copied.");const fail=()=>showNotice(`Couldn't copy. Select the text and press ${IS_MAC?"Cmd":"Ctrl"}+C.`);
  if(Desk&&Desk.copy){Desk.copy(text).then(done,fail);return}
  try{navigator.clipboard.writeText(text).then(done,fail)}catch(e){fail()}}

/* ---------- core actions every page has ---------- */
Object.assign(A,{
  "open-modal":el=>{ui.modal=el.dataset.m;renderModal()},
  "close-modal":()=>{ui.modal=null;ui.confirm=null;renderModal()},
  "close-modal-bg":(el,ev)=>{if(ev.target===el){ui.modal=null;ui.confirm=null;renderModal()}},
  "pick-file":()=>document.getElementById("file-in").click(),
  "mono-home":()=>{if(Desk&&Desk.goHome)Desk.goHome();else location.href="launcher.html"},
  "open-backups":()=>Desk&&Desk.openBackups&&Desk.openBackups(),
});
document.addEventListener("click",ev=>{
  const el=ev.target.closest("[data-act]");if(!el||el.disabled)return;
  const f=A[el.dataset.act];if(f){if(el.tagName==="BUTTON")ev.preventDefault();f(el,ev)}
});
document.addEventListener("change",ev=>{const el=ev.target.closest("[data-act-change]");if(el&&CHANGE[el.dataset.actChange])CHANGE[el.dataset.actChange](el)});
document.addEventListener("input",ev=>{const el=ev.target;
  if(el.dataset.ui&&!el.dataset.confirmFor){setPath(ui,el.dataset.ui,el.value);if(el.dataset.rerender!==undefined){const pos=el.selectionStart;render();const again=document.getElementById(el.id);if(again){again.focus();try{again.setSelectionRange(pos,pos)}catch(e){}}}}});
document.addEventListener("keydown",ev=>{
  if(ev.key==="Escape"){if(document.getElementById("print-host")&&!document.getElementById("print-host").hidden)return;
    if(ui.modal){ui.modal=null;ui.confirm=null;renderModal()}else if(typeof Tray!=="undefined"&&Tray.open){Tray.open=false;Tray.render()}}
  if(ev.key==="Enter"&&ev.target.id==="tray-expr")A["tray-roll"]();
});
/* type-to-confirm boxes: <input data-confirm-for="button-id" data-need="text"> */
document.addEventListener("input",ev=>{const el=ev.target;if(!el.dataset||!el.dataset.confirmFor)return;
  if(el.dataset.ui)setPath(ui,el.dataset.ui,el.value);
  const b=document.getElementById(el.dataset.confirmFor);if(b)b.disabled=el.value.trim().toLowerCase()!==String(el.dataset.need||"").toLowerCase()});
document.addEventListener("keydown",ev=>{const el=ev.target;if(ev.key!=="Enter"||!el.dataset||!el.dataset.confirmFor)return;ev.preventDefault();
  const b=document.getElementById(el.dataset.confirmFor);if(b&&!b.disabled)b.click()});
/* dropping files anywhere on the page */
document.addEventListener("dragover",ev=>{if([...(ev.dataTransfer?.types||[])].includes("Files")){ev.preventDefault();document.body.classList.add("dropping")}});
document.addEventListener("dragleave",ev=>{if(ev.target===document.documentElement||!ev.relatedTarget)document.body.classList.remove("dropping")});
document.addEventListener("drop",ev=>{if(ev.dataTransfer?.files?.length){ev.preventDefault();document.body.classList.remove("dropping");onFilesPicked(ev.dataTransfer.files)}});
document.getElementById("file-in")?.addEventListener("change",ev=>{if(ev.target.files.length)onFilesPicked(ev.target.files);ev.target.value=""});
/* files go to the game first (packages, its own formats), then to the core importer */
const FILE_HANDLERS=[];
async function onFilesPicked(files){let list=[...files];
  for(const h of FILE_HANDLERS){try{list=await h(list)||list}catch(e){console.error(e)}if(!list.length)return}
  if(list.length&&typeof importFiles==="function")importFiles(list)}

/* a typed confirmation field and its button */
function confirmField(id,need,btnId,label){return `<div class="field"><label class="label" for="${id}">${label||"To confirm, type"} <span class="mono need">${esc(need)}</span></label>
  <input id="${id}" autocomplete="off" spellcheck="false" data-confirm-for="${btnId}" data-need="${esc(need)}" placeholder="${esc(need)}"></div>`}
