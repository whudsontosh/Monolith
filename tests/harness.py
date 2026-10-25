"""Shared set-up for Monolith's page tests: the app's pages, the tiny test game (or TEST_GAME_DIR),
a real table server, and a stand-in for the desktop app's bridge."""
import os, json, subprocess, tempfile
HERE=os.path.dirname(os.path.abspath(__file__))
ROOT=os.path.dirname(HERE)
MONO=ROOT
APP="file://"+os.path.join(MONO,"app")+"/"
GAME_DIR=os.path.abspath(os.environ.get("TEST_GAME_DIR",os.path.join(ROOT,"testgame")))
GAME_BASE="file://"+GAME_DIR+"/"
MANIFEST=json.load(open(os.path.join(GAME_DIR,"game.json")))
FIX=os.path.join(HERE,"fixtures")
OUT=os.environ.get("TEST_OUT",os.path.join(ROOT,"test-out"));os.makedirs(OUT,exist_ok=True)
assets=tempfile.mkdtemp()
srv=subprocess.Popen(["node",os.path.join(MONO,"server.js"),"0",assets,"ADMINKEY"],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,stdin=subprocess.DEVNULL,text=True)
import atexit;atexit.register(lambda:srv.kill())
port=int(srv.stdout.readline().split()[1])
INFO=dict(MANIFEST,base=GAME_BASE)
SHIM="""(()=>{const port=%d;const info=%s;window.__backups={};window.__clip='';window.__ensure=[];window.__home=0;const subs=[];
const api={platform:'win32',appVersion:async()=>'1.0.0',gameInfo:async()=>info,gameEnsure:async(id,v)=>{window.__ensure.push([id,v]);return {ok:false,msg:'test: no installs'}},
serverInfo:async()=>({port,adminKey:'ADMINKEY'}),hostState:async()=>({tunnel:{state:'off'},direct:null}),
tunnelStart:async()=>{subs.forEach(f=>f({state:'starting',msg:'Opening a secure link…'}));await new Promise(r=>setTimeout(r,300));return 'http://127.0.0.1:'+port},
tunnelStop:async()=>true,onTunnel:f=>subs.push(f),directStart:async p=>({port:p}),directStop:async()=>true,lanIps:async()=>['192.168.1.20'],publicIp:async()=>'203.0.113.7',
backup:async(k,t)=>{window.__backups[k]=t.length;try{const o=JSON.parse(sessionStorage.getItem('__bk')||'{}');o[k]=(o[k]||0)+1;sessionStorage.setItem('__bk',JSON.stringify(o))}catch(e){}return true},
openBackups:async()=>true,openData:async()=>true,copy:async t=>{window.__clip=t;return true},openPlayerWindow:async()=>true,savePdf:async()=>({saved:false}),goHome:async()=>{window.__home++;return true},
onUpdate:()=>{},updateSkip:async()=>true};
let claimed=false;window.monolithDesk={claim:()=>{if(claimed)return null;claimed=true;return api}};})();"""%(port,json.dumps(INFO))
results=[];errs=[]
def ok(c,m):
    results.append((bool(c),m));print(("ok  " if c else "FAIL"),m,flush=True)
async def page(b,name,url,viewport=None,shim=True):
    ctx=await b.new_context(viewport=viewport or {"width":1440,"height":900})
    if shim: await ctx.add_init_script(SHIM)
    pg=await ctx.new_page()
    pg.on("pageerror",lambda e:errs.append(name+": "+str(e)))
    pg.on("console",lambda m:errs.append(name+" console: "+m.text) if m.type=="error" and "ERR_" not in m.text else None)
    await pg.goto(APP+url);await pg.wait_for_function("()=>typeof GAME!=='undefined'&&!!GAME&&document.querySelector('#app').children.length>0",timeout=8000)
    await pg.wait_for_timeout(250)
    return pg
async def ctx_page(ctx,name,url):
    pg=await ctx.new_page()
    pg.on("pageerror",lambda e:errs.append(name+": "+str(e)))
    pg.on("console",lambda m:errs.append(name+" console: "+m.text) if m.type=="error" and "ERR_" not in m.text else None)
    await pg.goto(APP+url);await pg.wait_for_function("()=>typeof GAME!=='undefined'&&!!GAME&&document.querySelector('#app').children.length>0",timeout=8000)
    await pg.wait_for_timeout(250)
    return pg
async def join(pg,code,name,cname):
    await pg.click("[data-act=go-table]");await pg.wait_for_timeout(150)
    await pg.fill("#join-code",code);await pg.fill("#join-name",name)
    cid=await pg.evaluate("h=>[...S.chars.values()].find(c=>charLabel(c)===h).id",cname)
    await pg.select_option("#join-char",cid);await pg.click("[data-act=net-join]");await pg.wait_for_timeout(900)
def finish():
    try: srv.kill()
    except Exception: pass
    n=len(results);bad=[m for c,m in results if not c]
    print(f"\n{n-len(bad)}/{n} passed")
    if errs: print("page errors:\n  "+"\n  ".join(errs[:30]))
    return 0 if not bad and not errs else 1
