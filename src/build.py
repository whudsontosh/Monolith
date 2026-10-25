"""Builds Monolith's pages.
   app/   the desktop app's pages (local fonts, a content security policy that allows game://)
   web/   the same pages for a browser, used by the tests (load a game with ?devgame=<folder>)"""
import os, re, shutil, json
HERE=os.path.dirname(os.path.abspath(__file__))
ROOT=os.path.dirname(HERE)
def rd(*p): return open(os.path.join(HERE,*p),encoding="utf-8").read()

VERSION=json.load(open(os.path.join(ROOT,"package.json")))["version"]
CORE=["core/util.js","core/monolith.js","core/ui.js","core/dice.js","core/store.js","core/print.js","core/zip.js","core/map.js","core/table.js"]
ROLES={"player":["player/store.js","player/net.js","player/boot.js"],"gm":["gm/state.js","gm/campaigns.js","gm/host.js","gm/boot.js"]}
CSS=rd("monolith.css")
MORPH="/*! morphdom 2.7.4 | MIT License | (c) Patrick Steele-Idem | github.com/patrick-steele-idem/morphdom */\n"+rd("vendor","morphdom-umd.min.js")
def js(files): return "\n".join(f"/* ---- {f} ---- */\n"+rd(f) for f in files)
CSP=("default-src 'self' file:; script-src 'self' file: game: 'unsafe-inline'; style-src 'self' file: game: 'unsafe-inline'; "
     "font-src 'self' file: game: data:; img-src * data: blob:; media-src * data: blob:; connect-src *; worker-src blob:; "
     "object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'")
LAUNCH_CSP="default-src 'self' file:; script-src 'self' file: 'unsafe-inline'; style-src 'self' file: 'unsafe-inline'; font-src 'self' file: data:; img-src 'self' file: data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
def page(role):
    s=rd("shell","page.html").replace("/*ROLE*/",role).replace("/*CSS*/",CSS)
    body=MORPH+"\n"+f'const MONOLITH_VERSION="{VERSION}";\n'+js(CORE)+"\n"+js(ROLES[role])
    return s.replace("/*JS*/",body)
def launcher():
    return rd("shell","launcher.html").replace("/*CSS*/",CSS+"\n"+rd("launcher.css")).replace("/*JS*/",rd("launcher.js"))
def update():
    return rd("shell","update.html").replace("/*CSS*/",CSS+"\n"+rd("launcher.css"))
pages={"player.html":page("player"),"gm.html":page("gm"),"launcher.html":launcher(),"update.html":update()}
for out,csp in (("web",None),("app",True)):
    d=os.path.join(ROOT,out);os.makedirs(os.path.join(d,"fonts"),exist_ok=True)
    for name,html in pages.items():
        if csp:
            pol=LAUNCH_CSP if name in ("launcher.html","update.html") else CSP
            html=html.replace('<meta charset="utf-8">','<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="'+pol+'">',1)
        open(os.path.join(d,name),"w",encoding="utf-8").write(html)
    for f in os.listdir(os.path.join(HERE,"fonts")):shutil.copy(os.path.join(HERE,"fonts",f),os.path.join(d,"fonts",f))
print("built Monolith",VERSION)
