/* ============================== MONOLITH CORE: UTILITIES ==============================
   Small helpers every screen uses. Games use these too (they're part of Monolith API v1). */
const d=n=>1+Math.floor(Math.random()*n);
const pick=a=>a[Math.floor(Math.random()*a.length)];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=()=>Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-5);
const clone=o=>JSON.parse(JSON.stringify(o));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const sgn=n=>n>=0?"+"+n:String(n);
function parseDice(expr){
  const s=String(expr||"").trim().toUpperCase().replace(/\s+/g,"");
  if(/^-?\d+(\.\d+)?$/.test(s)) return {n:0,sides:0,mod:0,div:1,fixed:Number(s)};
  const m=s.match(/^(\d*)D(\d+)([+-]\d+)?(?:\/(\d+))?$/);
  if(!m) return null;
  return {n:Number(m[1]||1),sides:Number(m[2]),mod:Number(m[3]||0),div:Number(m[4]||1)};
}
function rollDice(expr){
  const p=parseDice(expr); if(!p) return null;
  if(p.fixed!=null) return {total:p.fixed,rolls:[],text:String(p.fixed)};
  if(!p.sides) return null;
  const rolls=[];for(let i=0;i<Math.min(p.n,60);i++)rolls.push(d(p.sides));
  let t=rolls.reduce((a,b)=>a+b,0)+p.mod; if(p.div>1)t=Math.ceil(t/p.div);
  return {total:Math.max(0,t),rolls,text:`[${rolls.join(",")}]${p.mod?sgn(p.mod):""}${p.div>1?"/"+p.div:""}`};
}
function avgDice(expr){
  const p=parseDice(expr); if(!p) return 0; if(p.fixed!=null) return p.fixed;
  return Math.ceil((p.n*(p.sides+1)/2+p.mod)/p.div);
}
function getPath(o,path){return path.split(".").reduce((a,k)=>a==null?a:a[k],o)}
function setPath(o,path,v){const ks=path.split(".");let t=o;for(let i=0;i<ks.length-1;i++){if(t[ks[i]]==null)t[ks[i]]={};t=t[ks[i]]}t[ks[ks.length-1]]=v}
const LS={get(k,f){try{const v=localStorage.getItem(k);return v==null?f:JSON.parse(v)}catch(e){return f}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},
  del(k){try{localStorage.removeItem(k)}catch(e){}}};
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}}
function lsSize(prefix){let n=0;try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith(prefix))n+=(localStorage.getItem(k)||"").length}}catch(e){}return n}
function fmtKB(n){return n>1e6?(n/1e6).toFixed(1)+" MB":Math.max(1,Math.round(n/1024))+" KB"}
const idle=fn=>(window.requestIdleCallback?window.requestIdleCallback(fn,{timeout:1200}):setTimeout(fn,120));
function ssGet(k){try{return sessionStorage.getItem(k)}catch(e){return null}}
function ssSet(k,v){try{if(v==null)sessionStorage.removeItem(k);else sessionStorage.setItem(k,v)}catch(e){}}

/* ---- time & names ---- */
function stamp(t=Date.now()){const x=new Date(t),p=n=>String(n).padStart(2,"0");return `${x.getFullYear()}-${p(x.getMonth()+1)}-${p(x.getDate())}_${p(x.getHours())}${p(x.getMinutes())}`}
function fmtTime(t){if(!t)return "never";const x=new Date(t);const same=new Date().toDateString()===x.toDateString();return same?x.toLocaleTimeString([], {hour:"numeric",minute:"2-digit",second:"2-digit"}):x.toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}
function ago(t){if(!t)return "never";const s=Math.round((Date.now()-t)/1000);if(s<10)return "just now";if(s<60)return s+"s ago";const m=Math.round(s/60);if(m<60)return m+" min ago";const h=Math.round(m/60);if(h<48)return h+" h ago";return Math.round(h/24)+" days ago"}
function safeName(s){return String(s||"file").replace(/[^a-z0-9_-]+/gi,"-").replace(/^-+|-+$/g,"").slice(0,40)||"file"}
function slugify(s,n=32){return String(s||"").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,n)}
function cleanText(s,n){return String(s??"").replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,n)}

/* ---- files ---- */
function downloadText(filename,text,type="application/json"){
  try{const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{a.remove();URL.revokeObjectURL(url)},1500);return true}
  catch(e){showNotice("The download was blocked.");return false}
}
function downloadBlob(filename,blob){try{const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{a.remove();URL.revokeObjectURL(url)},1500);return true}catch(e){showNotice("The download was blocked.");return false}}
function readFiles(fileList){return Promise.all([...fileList].map(f=>f.text().then(text=>({name:f.name,text})).catch(()=>({name:f.name,text:""}))))}

/* ---- layout helper: two balanced columns in plain grid ---- */
function cols2(parts,weights){const total=weights.reduce((a,b)=>a+b,0);let acc=0,cut=parts.length;
  for(let i=0;i<parts.length;i++){if(acc+weights[i]/2>=total/2){cut=i;break}acc+=weights[i]}
  if(cut===0&&parts.length>0)cut=1;
  return `<div class="cols2"><div>${parts.slice(0,cut).join("")}</div><div>${parts.slice(cut).join("")}</div></div>`}

/* ---- base64url (invite codes) ---- */
function b64e(s){return btoa(unescape(encodeURIComponent(s))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}
function b64d(s){s=String(s).replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";return decodeURIComponent(escape(atob(s)))}
