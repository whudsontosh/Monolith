/* ============================== MONOLITH CORE: PRINTING ==============================
   Print.open({title, options:[{key,label,def}], render(opts)->html, css}) shows a print preview
   of the game's paper pages, with Print and (in the desktop app) Save as PDF. */
const Print={host:null,cfg:null,opts:{},style:null,
  ensure(){if(this.host)return;const h=document.createElement("div");h.id="print-host";h.hidden=true;document.body.appendChild(h);this.host=h;
    const st=document.createElement("style");st.textContent=`
#print-host{position:fixed;inset:0;z-index:80;background:#1b1c20;display:flex;flex-direction:column}
#print-host[hidden]{display:none}
.pv-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:calc(10px + env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) 10px max(16px,env(safe-area-inset-left,0px));background:var(--band);color:var(--band-ink);border-bottom:1px solid var(--line)}
.pv-bar h2{font-family:var(--f-display);font-size:20px;margin:0 8px 0 0}
.pv-bar label{display:flex;gap:6px;align-items:center;font-size:13px;color:var(--band-ink2)}
.pv-bar .sp{flex:1}
.pv-scroll{flex:1;overflow:auto;padding:24px 16px 40px}
@media (max-width:900px){.pv-scroll .page{zoom:.55}}
@media print{
  @page{size:letter;margin:.35in}
  html,body{background:#fff!important;padding:0!important}
  body::before,body::after{display:none!important}
  body>*:not(#print-host){display:none!important}
  #print-host{position:static!important;display:block!important;background:#fff!important}
  .pv-bar{display:none!important}
  .pv-scroll{overflow:visible!important;padding:0!important}
  .pv-scroll .page{zoom:1!important;width:auto!important;min-height:0!important;padding:0!important;margin:0!important;box-shadow:none!important;break-after:page;page-break-after:always}
  .pv-scroll .page:last-child{break-after:auto;page-break-after:auto}
}`;document.head.appendChild(st);
    this.style=document.createElement("style");document.head.appendChild(this.style);
    h.addEventListener("click",ev=>{const b=ev.target.closest("[data-pv]");if(!b)return;const a=b.dataset.pv;
      if(a==="close")this.close();
      if(a==="pdf"&&Desk&&Desk.savePdf){Desk.savePdf(safeName(this.cfg.title)).then(r=>{if(r&&r.saved)showNotice("PDF saved.")}).catch(()=>showNotice("Couldn't save the PDF."))}
      if(a==="print"){try{window.print()}catch(e){showNotice("Printing isn't available here.")}}});
    h.addEventListener("change",ev=>{const t=ev.target;if(t.dataset.pvopt){this.opts[t.dataset.pvopt]=t.checked;this.draw()}});
    document.addEventListener("keydown",ev=>{if(ev.key==="Escape"&&!this.host.hidden){ev.stopPropagation();this.close()}},true);
  },
  open(cfg){this.ensure();this.cfg=cfg;this.style.textContent=cfg.css||"";this.opts={};(cfg.options||[]).forEach(o=>this.opts[o.key]=o.def);this.host.hidden=false;document.body.style.overflow="hidden";this.draw()},
  close(){this.host.hidden=true;this.host.innerHTML="";document.body.style.overflow=""},
  draw(){const c=this.cfg;this.host.innerHTML=`<div class="pv-bar"><h2>${esc(c.title)}</h2>${(c.options||[]).map(o=>`<label><input type="checkbox" data-pvopt="${o.key}" ${this.opts[o.key]?"checked":""}> ${esc(o.label)}</label>`).join("")}<span class="sp"></span>
    ${Desk&&Desk.savePdf?`<button class="btn primary" data-pv="pdf">Save as PDF…</button><button class="btn" data-pv="print">Print…</button>`:`<button class="btn primary" data-pv="print">Print / Save as PDF</button>`}<button class="btn" data-pv="close">Close</button></div>
    <div class="pv-scroll">${c.render(this.opts)}</div>`},
};
Monolith.print=Print;
