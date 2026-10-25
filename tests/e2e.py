"""End to end in the real desktop app (a developer copy under xvfb): the game shelf, installing a
signed game from a stand-in for GitHub, Player/GM, game:// serving, the bridge staying out of game
code, hosting and joining between windows, game updates on open, a player fetching the GM's exact
version, and a tampered install refusing to run.
Needs a built game: GAME_DIST (default ../monolith-cyberpunk/dist/game)."""
import asyncio, subprocess, os, sys, time, json, glob, shutil, hashlib, zipfile, tempfile, threading, http.server, functools, base64
from playwright.async_api import async_playwright
HERE=os.path.dirname(os.path.abspath(__file__));ROOT=os.path.dirname(HERE)
GAME_DIST=os.path.abspath(os.environ.get("GAME_DIST",os.path.join(ROOT,"..","monolith-cyberpunk","dist","game")))
OUT=os.environ.get("TEST_OUT",os.path.join(ROOT,"test-out"));os.makedirs(OUT,exist_ok=True)
WORK=tempfile.mkdtemp(prefix="mono-e2e-");WEB=os.path.join(WORK,"web");HOME=os.path.join(WORK,"home")
os.makedirs(WEB);os.makedirs(HOME)
results=[]
def ok(c,m):results.append(bool(c));print(("ok   " if c else "FAIL ")+m,flush=True)

# a test signing key (the real one never leaves the publisher)
key=subprocess.run(["node","-e","const c=require('crypto');const k=c.generateKeyPairSync('ed25519');process.stdout.write(JSON.stringify({priv:k.privateKey.export({type:'pkcs8',format:'pem'}),pub:k.publicKey.export({type:'spki',format:'pem'})}))"],capture_output=True,text=True,check=True)
KEY=json.loads(key.stdout);open(os.path.join(WORK,"key.pem"),"w").write(KEY["priv"])
def publish(version,latest=True):
    """builds a release of the game at `version` the way the game's own build does, and signs it"""
    src=os.path.join(WORK,"src-"+version);shutil.rmtree(src,ignore_errors=True);shutil.copytree(GAME_DIST,src)
    m=json.load(open(os.path.join(src,"game.json")));m["version"]=version;json.dump(m,open(os.path.join(src,"game.json"),"w"))
    files={}
    for dp,dn,fn in os.walk(src):
        for f in sorted(fn):
            p=os.path.join(dp,f);rel=os.path.relpath(p,src).replace(os.sep,"/");files[rel]=hashlib.sha256(open(p,"rb").read()).hexdigest()
    zname=f"{m['id']}-{version}.zip";z=os.path.join(WORK,zname)
    with zipfile.ZipFile(z,"w",zipfile.ZIP_DEFLATED) as zf:
        for rel in sorted(files):zf.write(os.path.join(src,rel),rel)
    data=open(z,"rb").read()
    rel={"format":"monolith-game-release","id":m["id"],"name":m["name"],"version":version,"api":1,"minMonolith":"1.0.0","file":zname,"size":len(data),"sha256":hashlib.sha256(data).hexdigest(),"files":files}
    for d in ([f"whudsontosh/monolith-{m['id']}/releases/download/v{version}"]+([f"whudsontosh/monolith-{m['id']}/releases/latest/download"] if latest else [])):
        dd=os.path.join(WEB,d);os.makedirs(dd,exist_ok=True)
        open(os.path.join(dd,"release.json"),"w").write(json.dumps(rel))
        shutil.copy(z,os.path.join(dd,zname))
        subprocess.run(["node",os.path.join(ROOT,"scripts","sign.js"),"--key",os.path.join(WORK,"key.pem"),os.path.join(dd,"release.json")],check=True,capture_output=True)
    return m["id"]
GID=publish("1.0.0")
json.dump({"format":"monolith-games","games":[{"id":GID,"name":"Cyberpunk","repo":f"whudsontosh/monolith-{GID}","tagline":"test","rulesets":[{"id":"cp2020","name":"Cyberpunk 2020"}]}]},open(os.path.join(WEB,"games.json"),"w"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a):pass
httpd=http.server.ThreadingHTTPServer(("127.0.0.1",0),functools.partial(Q,directory=WEB));PORT=httpd.server_address[1]
threading.Thread(target=httpd.serve_forever,daemon=True).start()

env=dict(os.environ,HOME=HOME,XDG_CONFIG_HOME=HOME+"/.config",ELECTRON_ENABLE_LOGGING="1",
  MONOLITH_GAMES_URL=f"http://127.0.0.1:{PORT}/games.json",MONOLITH_GITHUB_BASE=f"http://127.0.0.1:{PORT}/",MONOLITH_TEST_PUBLIC_KEY=KEY["pub"])
env.pop("MONOLITH_DEV_GAMES",None)
ELECTRON=os.path.join(ROOT,"node_modules","electron","dist","electron")
def start():
    return subprocess.Popen(["xvfb-run","-a","-s","-screen 0 1600x1000x24",ELECTRON,ROOT,"--no-sandbox","--disable-gpu","--disable-gpu-compositing","--in-process-gpu","--remote-debugging-port=9334"],
      env=env,stdout=open(os.path.join(OUT,"electron.log"),"a"),stderr=subprocess.STDOUT,start_new_session=True)
def stop(proc):
    import signal
    try: os.killpg(proc.pid,signal.SIGTERM)
    except Exception: pass
    try: proc.wait(10)
    except Exception:
        try: os.killpg(proc.pid,signal.SIGKILL)
        except Exception: pass
    time.sleep(1)
async def find(br,name,timeout=20,exclude=()):
    t0=time.time()
    while time.time()-t0<timeout:
        for ctx in br.contexts:
            for pg in ctx.pages:
                if name in pg.url and pg not in exclude: return pg
        await asyncio.sleep(0.3)
    return None
async def ready(pg):
    await pg.wait_for_function("()=>window.Monolith&&Monolith.gameDef&&document.querySelector('#nav')&&document.querySelector('#nav').children.length>0",timeout=20000);await pg.wait_for_timeout(500)
async def main():
    proc=start();errs=[]
    try:
        async with async_playwright() as p:
            for i in range(60):
                try: br=await p.chromium.connect_over_cdp("http://127.0.0.1:9334");break
                except Exception: await asyncio.sleep(0.5)
            lp=await find(br,"launcher.html");ok(lp is not None,"Monolith opens on the game shelf")
            await lp.wait_for_selector(".slab",timeout=15000);await lp.wait_for_timeout(500)
            ok(await lp.evaluate("typeof require==='undefined'&&typeof process==='undefined'"),"pages have no Node access (sandboxed)")
            ok(await lp.locator("#slabs-more .slab:has-text('Cyberpunk')").count()==1,"an approved game that isn't installed is under More games")
            await lp.screenshot(path=OUT+"/e2e-shelf-empty.png")
            await lp.click("#slabs-more [data-act=l-install]");await lp.wait_for_selector("#slabs .slab.go:has-text('Cyberpunk')",timeout=30000)
            ok(True,"installing downloads, checks and installs the signed game")
            inst=glob.glob(HOME+"/.config/*/games/cyberpunk/1.0.0/release.json.sig")
            ok(len(inst)==1,"it's installed in its own version folder with its signature")
            await lp.click("#slabs .slab.go");await lp.wait_for_timeout(200)
            ok(await lp.locator("[data-act=l-open][data-role=player]").count()==1 and await lp.locator("[data-act=l-open][data-role=gm]").count()==1,"choosing a game asks Player or Game master")
            await lp.screenshot(path=OUT+"/e2e-shelf-choose.png")
            await lp.click("[data-act=l-open][data-role=gm]")
            gm=await find(br,"gm.html");ok(gm is not None,"Game master opens the GM screens")
            gm.on("pageerror",lambda e:errs.append("gm: "+str(e)))
            await ready(gm)
            ok(await gm.evaluate("GAME_INFO.id==='cyberpunk'&&GAME_INFO.version==='1.0.0'&&GAME_INFO.base==='game://cyberpunk/1.0.0/'"),"the window plays Cyberpunk 1.0.0 from game://")
            ok(await gm.evaluate("document.documentElement.dataset.skin")=="cyberpunk","the game's skin applies")
            ok(await gm.evaluate("window.monolithDesk.claim()===null&&typeof window.desk==='undefined'"),"game code can't get the desktop bridge")
            r=await gm.evaluate("fetch('game://cyberpunk/1.0.0/release.json').then(r=>r.status).catch(()=>'blocked')")
            ok(r in (404,"blocked"),"files outside the signed list aren't served ("+str(r)+")")
            ok(await gm.evaluate("Host.port>0&&Host.ready"),"table server running and the GM is connected to it")
            await gm.click("nav [data-act=tab][data-t=map]");await gm.wait_for_timeout(300)
            await gm.click(".map-empty [data-act=map-add-blank]");await gm.wait_for_timeout(400)
            await gm.evaluate("hostLocal()");await gm.wait_for_timeout(300)
            code=await gm.evaluate("inviteCode()");ok(code.startswith("MON1."),"hosting gives an invite code")
            await gm.wait_for_timeout(4800)
            bk=[os.path.basename(b) for b in glob.glob(HOME+"/*/Monolith/backups/*.json")+glob.glob(HOME+"/Monolith/backups/*.json")]
            ok(any(b.startswith("cyberpunk-campaign-") for b in bk),"backup files land in Documents/Monolith/backups: "+str(bk[:3]))
            await gm.evaluate("Desk.openPlayerWindow()")
            pl=await find(br,"player.html");ok(pl is not None,"a player window opens on the same game")
            pl.on("pageerror",lambda e:errs.append("player: "+str(e)))
            await ready(pl)
            await pl.click(".card-foot >> text=Copy to my runners");await pl.wait_for_timeout(300)
            await pl.click("[data-act=go-table]");await pl.wait_for_timeout(200)
            await pl.fill("#join-code",code);await pl.fill("#join-name","Will");await pl.click("[data-act=net-join]");await pl.wait_for_timeout(1500)
            ok(await pl.evaluate("Net.state==='online'"),"the player window joined the GM's table")
            ok(await gm.evaluate("st.party.length===1"),"and the runner joined the party")
            await pl.evaluate("Dice.check('Handgun',14,{who:'Razor',dv:15})");await pl.wait_for_timeout(500)
            ok(await gm.evaluate("st.tableLog.some(e=>e.kind==='roll'&&(e.tags||[]).length)"),"rolls arrive with their verdicts")
            await pl.close()
            # a new version is published: opening the game updates it first
            publish("1.0.1")
            await gm.evaluate("Desk.goHome()");lp=await find(br,"launcher.html");await lp.wait_for_selector(".slab.go",timeout=15000);await lp.wait_for_timeout(800)
            ok("1.0.1" in await lp.inner_text("#slabs"),"the shelf shows that a newer version installs when opened")
            await lp.click("#slabs .slab.go");await lp.click("[data-act=l-open][data-role=player]")
            pl=await find(br,"player.html");await ready(pl)
            ok(await pl.evaluate("GAME_INFO.version")=="1.0.1","opening the game installed and opened 1.0.1")
            ok(len(glob.glob(HOME+"/.config/*/games/cyberpunk/*/release.json"))==2,"1.0.0 is kept for tables still on it")
            # back to GM on 1.0.0 in a second window, so a 1.0.1 player has to fetch the GM's version
            await pl.evaluate("Desk.goHome()");lp=await find(br,"launcher.html");await lp.wait_for_selector(".slab.go",timeout=15000)
            await lp.click("#slabs .slab.go");await lp.click("[data-act=l-open][data-role=gm]")
            gm=await find(br,"gm.html");await ready(gm)
            # pin this GM window to 1.0.0, as a GM who hasn't updated would be
            await gm.evaluate("Desk.gameEnsure('cyberpunk','1.0.0')");await gm.wait_for_timeout(1500);gm=await find(br,"gm.html");await ready(gm)
            ok(await gm.evaluate("GAME_INFO.version")=="1.0.0","a window can run an exact earlier version")
            await gm.evaluate("hostLocal()");await gm.wait_for_timeout(300);code=await gm.evaluate("inviteCode()")
            await gm.evaluate("Desk.openPlayerWindow()");await asyncio.sleep(1)
            pl=None
            for ctx in br.contexts:
                for pg in ctx.pages:
                    if "player.html" in pg.url: pl=pg
            await ready(pl)
            await pl.evaluate("Desk.gameEnsure('cyberpunk','1.0.1')");await asyncio.sleep(2)
            for ctx in br.contexts:
                for pg in ctx.pages:
                    if "player.html" in pg.url: pl=pg
            await ready(pl)
            ok(await pl.evaluate("GAME_INFO.version")=="1.0.1","the player window is on 1.0.1")
            await pl.click(".card-foot >> text=Copy to my runners");await pl.wait_for_timeout(300)
            await pl.click("[data-act=go-table]");await pl.wait_for_timeout(200)
            await pl.fill("#join-code",code);await pl.fill("#join-name","Ana");await pl.click("[data-act=net-join]")
            t0=time.time();state=None
            while time.time()-t0<25:
                await asyncio.sleep(1)
                for ctx in br.contexts:
                    for pg in ctx.pages:
                        if "player.html" in pg.url: pl=pg
                try: state=await pl.evaluate("[GAME_INFO&&GAME_INFO.version,typeof Net!=='undefined'&&Net.state]")
                except Exception: state=None
                if state and state[0]=="1.0.0" and state[1]=="online":break
            ok(state and state[0]=="1.0.0" and state[1]=="online","joining a 1.0.0 table from 1.0.1 switches the window to 1.0.0 and rejoins by itself: "+str(state))
            await pl.screenshot(path=OUT+"/e2e-player.png");await gm.screenshot(path=OUT+"/e2e-gm.png")
            await br.close()
    finally:
        stop(proc)
    # tampering with an installed file stops that version from running
    f=glob.glob(HOME+"/.config/*/games/cyberpunk/1.0.1/player.js")[0];open(f,"a").write("\n/* changed */")
    proc=start()
    try:
        async with async_playwright() as p:
            for i in range(60):
                try: br=await p.chromium.connect_over_cdp("http://127.0.0.1:9334");break
                except Exception: await asyncio.sleep(0.5)
            lp=await find(br,"launcher.html");await lp.wait_for_selector(".slab.go",timeout=15000)
            await lp.click("#slabs .slab.go");await lp.click("[data-act=l-open][data-role=player]")
            pl=await find(br,"player.html");await pl.wait_for_timeout(2500)
            ok("couldn't start" in (await pl.inner_text("#app")).lower(),"a changed file stops the game from starting, with a clear message")
            await br.close()
    finally:
        stop(proc)
    httpd.shutdown()
    print("page errors:",errs[:6])
    print(f"\n{sum(results)}/{len(results)} passed")
    sys.exit(0 if all(results) and not errs else 1)
asyncio.run(main())
