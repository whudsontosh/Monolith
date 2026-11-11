"""Monolith without Cyberpunk: the tiny test game provides only characters and a roll, and every
core screen still works (roster, backups, campaigns, hosting, joining, the map table, rolls, chat)."""
import asyncio, json, sys
from playwright.async_api import async_playwright
from harness import *

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        pl=await page(b,"P","player.html")
        ok(await pl.evaluate("GAME_INFO.id")=="testgame","the test game loaded from its manifest")
        ok(await pl.evaluate("typeof window.desk")=="undefined" and await pl.evaluate("window.monolithDesk.claim()") is None,"the desktop bridge is claimed by the core before the game runs")
        ok("Test Game" in await pl.inner_text("#brand"),"the frame names the game")
        await pl.click("[data-act=new-character] >> nth=0");await pl.wait_for_timeout(200)
        ok(await pl.evaluate("ui.view")=="edit","a game without a builder window opens its own view straight away")
        await pl.fill("#tg-name","Wren");await pl.click("[data-act=tg-done]");await pl.wait_for_timeout(700)
        saved=await pl.evaluate("JSON.parse(localStorage.getItem('monolith-roster-testgame'))")
        ok(saved and saved[0]["name"]=="Wren" and saved[0]["game"]=="testgame" and saved[0]["ruleset"]=="basic" and saved[0]["gameVersion"]=="0.1.0","characters save with their game, ruleset and version")
        await pl.click("[data-act=tg-roll][data-s=might]");await pl.wait_for_timeout(200)
        e=await pl.evaluate("Dice.log[0]")
        ok(e["label"]=="might" and len(e["tags"])==1,"a game roll lands in the dice log with its verdict tag")
        await pl.click("nav [data-act=go-roster]");await pl.wait_for_timeout(150)
        ok(await pl.locator(".card:has-text('Wren')").count()==1,"roster card drawn from the game's card()")
        await pl.click("nav [data-m=backups]");await pl.wait_for_timeout(150)
        ok(await pl.locator(".modal:has-text('Version history')").count()==1,"backups window works")
        await pl.click("[data-act=close-modal]")
        async with pl.expect_download() as dl: await pl.click(".panel [data-act=download-all]")
        d=await dl.value;path=OUT+"/tg-roster.json";await d.save_as(path);j=json.load(open(path))
        ok(j["format"]=="monolith-roster" and j["game"]=="testgame" and len(j["characters"])==1,"roster backup file names its game")
        await pl.click("[data-act=ask-delete] >> nth=0");await pl.wait_for_timeout(150)
        ok(await pl.is_disabled("#del-go"),"delete waits for the name")
        await pl.fill("#del-confirm","Wren");await pl.click("#del-go");await pl.wait_for_timeout(400)
        ok(await pl.evaluate("S.chars.size")==0 and await pl.evaluate("S.trash.length")==1,"deleted to recently deleted")
        await pl.set_input_files("#file-in",path);await pl.wait_for_timeout(400)
        ok(await pl.evaluate("S.chars.size")==1,"restored from the backup file")
        # GM: a game with no GM parts still gets campaigns, the party, the map and hosting
        gm=await page(b,"GM","gm.html")
        tabs=await gm.evaluate("[...document.querySelectorAll('#nav [data-act=tab]')].map(x=>x.dataset.t)")
        ok(tabs==["campaigns","party","map","campaign"],"GM nav has just the core tabs: "+str(tabs))
        x=await gm.evaluate("campsAll()")
        ok(x["list"][0]["game"]=="testgame" and x["list"][0]["ruleset"]=="basic","campaign tagged with the test game")
        await gm.click("nav [data-act=tab][data-t=map]");await gm.wait_for_timeout(200)
        await gm.click(".map-empty [data-act=map-add-blank]");await gm.wait_for_timeout(200)
        await gm.evaluate("hostOnline()");await gm.wait_for_timeout(900)
        ok(await gm.evaluate("Host.status")=="online","hosting works")
        code=await gm.evaluate("inviteCode()")
        await join(pl,code,"Sam","Wren")
        ok(await pl.evaluate("Net.state")=="online","player joined the table")
        ok(await gm.evaluate("st.party.map(c=>c.name).join()")=="Wren","character joined the party")
        ok(await gm.evaluate("st.maps[0].tokens.some(t=>t.kind==='pc'&&t.label==='Wren')"),"and got a token")
        await pl.click("[data-act=tg-roll] >> nth=0") if await pl.locator("[data-act=tg-roll]").count() else await pl.evaluate("A['tg-roll']({dataset:{s:'wits'}})")
        await pl.wait_for_timeout(400)
        last=await gm.evaluate("st.tableLog.filter(e=>e.kind==='roll').pop()")
        ok(last and last["who"]=="Wren" and len(last.get("tags",[]))==1,"rolls reach the GM's log with the game's verdict")
        # 3D dice: your own roll tumbles on your screen only; the result still reaches everyone
        ok(await pl.evaluate("Dice3D.count")==1 and await pl.locator("canvas.dice3d").count()==1,"the player's own roll throws its one D6 across their screen")
        ok(await gm.locator("canvas.dice3d").count()==0,"the GM gets the result without the player's dice")
        n=await pl.evaluate("(async()=>{let k=0;const r=Math.random;Math.random=()=>{k++;return r()};Dice3D.start([[20,5],[6,2]]);await new Promise(f=>setTimeout(f,300));Math.random=r;return k})()")
        ok(n==0,"the animation never uses Math.random, so rigged test dice stay in step")
        r=await pl.evaluate("(()=>{const out=[];for(let i=0;i<40;i++){Dice3D.start([[20,7],[10,10],[6,1],[8,3],[12,12],[4,2]].slice(0,1+i%6));out.push(...Dice3D._rest())}Dice3D.stop();return out})()")
        ok(all(0<x["x"]<x["w"] and 0<x["y"]<x["h"] for x in r),"thrown dice bounce off the window's edges and stay inside it")
        ok(max(abs(x["face"]) for x in r)<1e-6,"after all the tumbling, every die rests exactly on its rolled face")
        ok(max(x["t"] for x in r)<3,"dice come to rest within a few seconds")
        ok(await pl.evaluate("Dice3D.plan([[100,100],[100,7],[3,2],[20,21]]).map(p=>p.label).join()")=="00,0,00,7","percentile dice become two D10s; odd or impossible dice are left out")
        ok(await pl.evaluate("(()=>{d(6);d(6);return new Promise(r=>setTimeout(()=>r(DiceCap.take().length),20))})()")==0,"dice rolled for anything but a roll entry are forgotten")
        await pl.click("[data-act=toggle-tray]");await pl.wait_for_timeout(100)
        await pl.uncheck("[data-act-change=dice3d]");await pl.wait_for_timeout(100)
        ok(await pl.locator("canvas.dice3d").count()==0 and await pl.evaluate("Settings.get('dice3d')")==False,"turning 3D dice off stops them and is remembered")
        await pl.click("[data-act=quick-roll][data-e='1D20']");await pl.wait_for_timeout(200)
        ok(await pl.locator("canvas.dice3d").count()==0 and await pl.evaluate("Dice.log[0].label")=="1D20","with 3D dice off the roll still happens, without the animation")
        await pl.check("[data-act-change=dice3d]");await pl.click("[data-act=toggle-tray]")
        await pl.fill("#chat-in","hello");await pl.press("#chat-in","Enter");await pl.wait_for_timeout(300)
        ok(await gm.evaluate("st.tableLog.some(e=>e.kind==='chat'&&e.text==='hello')"),"chat works")
        # the grid (grid.js): hexes, diagonal rules, measuring, snapping
        bad=await gm.evaluate("""(()=>{const bad=[],ok=(c,m)=>{if(!c)bad.push(m)};
          for(const type of ['hex-flat','hex-pointy','square']){const g={type,size:70,ox:13,oy:-22};
            for(let q=-5;q<=5;q++)for(let r=-5;r<=5;r++){const m=Grid.center(g,{q,r}),c=Grid.cell(g,m.x,m.y);ok(c.q===q&&c.r===r,type+' cell of its own middle');
              for(let k=0;k<6;k++){const c2=Grid.cell(g,m.x+Math.cos(k*1.1)*30,m.y+Math.sin(k*1.1)*30);ok(c2.q===q&&c2.r===r,type+' points near the middle')}}
            if(type!=='square'){const a=Grid.center(g,{q:0,r:0});for(const [dq,dr] of [[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]]){const b=Grid.center(g,{q:dq,r:dr});ok(Math.abs(Math.hypot(a.x-b.x,a.y-b.y)-70)<1e-9,type+' neighbours one size apart')}
              const f=Grid.corners({type,size:70},{q:0,r:0});ok(Math.abs(Math.min(...f.map(p=>p.x)))<1e-9&&Math.abs(Math.min(...f.map(p=>p.y)))<1e-9,type+' first hex in the corner')}}
          const P=(g,c)=>Grid.center(g,c);let g={type:'hex-pointy',size:50},r;
          ok(Grid.measure(g,[P(g,{q:0,r:0}),P(g,{q:3,r:-1})]).cells===3&&Grid.measure(g,[P(g,{q:0,r:0}),P(g,{q:2,r:2})]).cells===4,'hex steps');
          g={size:50,diag:'one',m:5,unit:'ft'};r=Grid.measure(g,[P(g,{q:0,r:0}),P(g,{q:4,r:3})]);ok(r.text==='20 ft · 4 sq','diagonals as one: '+r.text);
          g={size:50,diag:'alternate',m:5,unit:'ft'};r=Grid.measure(g,[P(g,{q:0,r:0}),P(g,{q:4,r:3})]);ok(r.text==='25 ft · 5 sq','alternating: '+r.text);
          ok(Grid.measure(g,[P(g,{q:0,r:0}),P(g,{q:1,r:1}),P(g,{q:2,r:2})]).cells===3,'alternating carries across a corner');
          r=Grid.measure({size:70},[{x:0,y:0},{x:210,y:280}]);ok(r.text==='10 m · 5.0 sq','a map from before: '+r.text);
          r=Grid.measure({size:70,type:'none',m:1},[{x:0,y:0},{x:35,y:0}]);ok(r.text==='0.5 m','no grid: '+r.text);
          ok(JSON.stringify(snapPoint({size:70},100,100,1))==='{"x":105,"y":105}'&&JSON.stringify(snapPoint({size:70},100,100,2))==='{"x":70,"y":70}','square snapping unchanged');
          g={type:'hex-flat',size:70};let s=Grid.snap(g,200,200,2),c=Grid.cell(g,200,200);ok(Grid.corners(g,c).some(p=>Math.hypot(p.x-s.x,p.y-s.y)<1e-9),'even sizes on a hex corner');
          s=Grid.snap(g,200,200,3);ok(Math.hypot(s.x-Grid.center(g,c).x,s.y-Grid.center(g,c).y)<1e-9,'odd sizes on a hex middle');
          ok(Grid.snap({type:'none'},12.5,7,1).x===12.5,'no grid, no snap');
          ok(Grid.around({type:'hex-flat',size:70},300,300,2).length===19&&Grid.around({size:70},300,300,2).length===25,'places around a point');
          ok(Grid.describe({size:70},2100,1400)==='30×20 squares'&&Grid.unit({unit:'<b>ft'})==='bft'&&Grid.unit({})==='m'&&Grid.type({type:'x'})==='square','labels and cleaning');
          const f=Grid.fitBox({type:'square'},130,95,340,305,3);ok(f.size===70&&f.ox===60&&f.oy===25,'fit from a box');
          return bad})()""")
        ok(bad==[],"grid maths: hex cells, the three diagonal rules, snapping and units"+(": "+"; ".join(bad[:4]) if bad else ""))
        g0=await gm.evaluate("JSON.stringify(curMap().grid)")
        await gm.evaluate("ui.mapSettingsOpen=true;render()")
        await gm.select_option("#mm-type","hex-flat");await gm.wait_for_timeout(500)
        ok(await pl.evaluate("Net.scene.grid.type")=="hex-flat" and await gm.locator("#mm-diag").count()==0,"the GM switches a map to hexes and players get it")
        pos=await gm.evaluate("(()=>{const m=curMap(),t=m.tokens[0],s=MapV.toScreen(t.x,t.y),r=MapV.canvas.getBoundingClientRect();return [r.left+s.x,r.top+s.y]})()")
        await gm.mouse.move(pos[0],pos[1]);await gm.mouse.down();await gm.mouse.move(pos[0]+43,pos[1]+27,steps=4);await gm.mouse.up();await gm.wait_for_timeout(300)
        ok(await gm.evaluate("(()=>{const m=curMap(),t=m.tokens[0],c=Grid.center(m.grid,Grid.cell(m.grid,t.x,t.y));return Math.hypot(c.x-t.x,c.y-t.y)<1})()"),"a dragged token comes to rest on the middle of a hex")
        await gm.click("[data-act=map-tool][data-t=ruler]");await gm.wait_for_timeout(100)
        r=await gm.evaluate("(()=>{const r=MapV.canvas.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()")
        await gm.keyboard.down("Shift");await gm.mouse.click(r[0]-120,r[1]-60);await gm.mouse.click(r[0],r[1]-60);await gm.keyboard.up("Shift")
        await gm.mouse.move(r[0],r[1]+70,steps=3);await gm.wait_for_timeout(250)
        x=await gm.evaluate("({n:MapV.ruler.pts.length,path:MapV.ruler.path,m:Grid.measure(curMap().grid,MapV.ruler.pts)})")
        ok(x["n"]==3 and x["path"] and x["m"]["counted"] and x["m"]["cells"]==int(x["m"]["cells"])>0 and x["m"]["text"].endswith(" hex"),"Shift+click measures around a corner, in whole hexes: "+x["m"]["text"])
        v=await pl.evaluate("typeof PMapV!=='undefined'&&PMapV?Object.values(PMapV.remoteRulers).map(r=>(r.via||[]).length)[0]:-1")
        ok(v in (2,-1),"players see the measured path with its corner")
        await gm.mouse.click(r[0],r[1]+70);await gm.wait_for_timeout(100)
        ok(await gm.evaluate("MapV.ruler&&MapV.ruler.path===false"),"a plain click ends the path")
        await gm.click("[data-act=map-tool][data-t=select]")
        await gm.select_option("#mm-type","square");await gm.wait_for_timeout(100);await gm.select_option("#mm-diag","one");await gm.fill("#mm-m","5");await gm.fill("#mm-unit","ft");await gm.wait_for_timeout(500)
        ok(await pl.evaluate("Grid.measure(Net.scene.grid,[{x:35,y:35},{x:315,y:245}]).text")=="20 ft · 4 sq","units and the diagonal rule reach players")
        await gm.fill("#mm-fitn","2");await gm.click("[data-act=mm-fit]");await gm.wait_for_timeout(100)
        a=await gm.evaluate("(()=>{const r=MapV.canvas.getBoundingClientRect(),p=MapV.toScreen(100,60),q=MapV.toScreen(260,220);return [r.left+p.x,r.top+p.y,r.left+q.x,r.top+q.y]})()")
        await gm.mouse.move(a[0],a[1]);await gm.mouse.down();await gm.mouse.move(a[2],a[3],steps=3);await gm.mouse.up();await gm.wait_for_timeout(200)
        f=await gm.evaluate("curMap().grid")
        ok(abs(f["size"]-80)<1.5 and abs(f["ox"]-20)<2 and abs(f["oy"]-60)<2 and await gm.evaluate("ui.mapTool")=="select","dragging a box across 2 squares aligns the grid to the picture: "+str([f["size"],f["ox"],f["oy"]]))
        await gm.evaluate("g=>{Object.assign(curMap().grid,JSON.parse(g));delete curMap().grid.type;save();render();MapV.invalidate()}",g0)
        # area templates (templates.js): shapes, who is caught, players' own, the game's presets
        bad=await gm.evaluate("""(()=>{const bad=[],ok=(c,m)=>{if(!c)bad.push(m)},g={size:70,m:5,unit:'ft'},T=(o)=>Tpl.clean({x:700,y:700,size:2,width:1,angle:0,...o}),tok=(x,y,size=1)=>({id:'t',x,y,size});
          let t=T({shape:'circle'});ok(Tpl.contains(t,g,840,700)&&!Tpl.contains(t,g,842,700)&&Tpl.contains(t,g,700,560),'circle edge');
          t=T({shape:'cone',size:4});ok(Tpl.contains(t,g,700,700)&&Tpl.contains(t,g,980,700)&&!Tpl.contains(t,g,983,700)&&Tpl.contains(t,g,900,795)&&!Tpl.contains(t,g,900,812)&&!Tpl.contains(t,g,650,700),'cone as wide as it is long');
          t=T({shape:'line',size:4,width:1,angle:Math.PI/2});ok(Tpl.contains(t,g,700,980)&&Tpl.contains(t,g,734,800)&&!Tpl.contains(t,g,737,800)&&!Tpl.contains(t,g,700,690),'line turned a quarter');
          t=T({shape:'square',size:2});ok(Tpl.contains(t,g,840,840)&&!Tpl.contains(t,g,842,700)&&!Tpl.contains(t,g,690,700),'square from its corner');
          t=T({shape:'circle'});GAME.map={};ok(Tpl.catches(t,g,tok(835,700))&&!Tpl.catches(t,g,tok(875,700)),'centre rule');
          GAME.map={inside:'touch'};ok(Tpl.catches(t,g,tok(870,700))&&!Tpl.catches(t,g,tok(876,700))&&Tpl.catches(t,g,tok(905,700,2)),'touch rule');
          GAME.map={inside:'cells'};const cs=Tpl.cells(t,g).length;ok(cs===12||cs===16,'a 10 ft radius covers '+cs+' squares');ok(Tpl.catches(t,g,tok(735,735))&&!Tpl.catches(t,g,tok(875,875)),'cells rule');
          ok(Tpl.cells(T({shape:'square',size:3}),g).length===9&&Tpl.cells(T({shape:'circle',size:2}),{type:'hex-flat',size:70}).length>=7,'covered cells on squares and hexes');
          GAME.map={templates:[{id:'fb',name:'Fireball',shape:'circle',size:20,color:'#ff4459'},{shape:'nope'}],origin:'corner'};const pr=Tpl.presets(g);ok(pr.length===1&&pr[0].size===4&&pr[0].name==='Fireball','a game preset in feet becomes cells');
          const o=Tpl.snapOrigin(g,100,100);ok(o.x===70&&o.y===70,'origins on corners when the game says so');GAME.map={origin:'centre'};ok(Tpl.snapOrigin(g,100,100).x===105,'or on middles');
          ok(Tpl.clean({shape:'blob'})===null&&Tpl.clean({shape:'cone',x:'a',size:1e9,color:'red',label:'<i>x'}).size===400&&Tpl.clean({shape:'cone',color:'red'}).color==='#f2a93b','cleaning');
          ok(Tpl.describe(T({shape:'line',size:8,width:1,label:'Bolt'}),g)==='Bolt · 40 × 5 ft line','describe');
          delete GAME.map;return bad})()""")
        ok(bad==[],"template maths: the four shapes, the three rules for who is caught, presets and cleaning"+(": "+"; ".join(bad[:4]) if bad else ""))
        async def mapdrag(pg,view,x1,y1,x2,y2):
            a=await pg.evaluate("([v,x1,y1,x2,y2])=>{const V=v==='gm'?MapV:PMapV,r=V.canvas.getBoundingClientRect(),p=V.toScreen(x1,y1),q=V.toScreen(x2,y2);return [r.left+p.x,r.top+p.y,r.left+q.x,r.top+q.y]}",[view,x1,y1,x2,y2])
            await pg.mouse.move(a[0],a[1]);await pg.mouse.down();await pg.mouse.move(a[2],a[3],steps=4);await pg.mouse.up();await pg.wait_for_timeout(350)
        await gm.evaluate("(()=>{const m=curMap(),t=m.tokens[0];t.x=385;t.y=385;window.__caught=[];GAME.map={onCaught:(t,toks)=>window.__caught.push([t.shape,toks.length])};save();MapV.invalidate()})()")
        await gm.click("[data-act=map-tool][data-t=template]");await gm.wait_for_timeout(100)
        await mapdrag(gm,"gm",350,350,350+3*70,350)
        x=await gm.evaluate("({t:curMap().templates,c:window.__caught,bar:document.querySelector('.map-sub').textContent})")
        ok(len(x["t"])==1 and x["t"][0]["shape"]=="circle" and x["t"][0]["size"]==3 and x["t"][0]["by"]=="gm","the GM drags out a circle, sized in whole squares")
        ok(x["c"]==[["circle",1]] and "Wren" in x["bar"],"the game is told who it caught, and the bar names them")
        ok(await pl.evaluate("Net.scene.templates.length")==1,"players see the GM's template")
        gid=x["t"][0]["id"]
        await mapdrag(gm,"gm",350+3*70,350,350+5*70,350)
        ok(await gm.evaluate("curMap().templates[0].size")==5,"dragging its square handle resizes it")
        await mapdrag(gm,"gm",350,350,700,700)
        ok(await gm.evaluate("(()=>{const t=curMap().templates[0];return t.x===700&&t.y===700})()"),"dragging its dot moves it")
        await pl.click("[data-act=map-tool][data-t=template]");await pl.wait_for_timeout(100)
        await pl.click("[data-act=tpl-shape][data-v=cone]")
        await mapdrag(pl,"pl",1050,350,1050+4*70,350)
        x=await gm.evaluate("curMap().templates.map(t=>[t.shape,t.by==='gm',t.size])")
        ok(x==[["circle",True,5],["cone",False,4]],"a player places their own cone and the GM gets it: "+str(x))
        await pl.evaluate("id=>netSend({t:'tpl',op:'del',id})",gid);await pl.evaluate("id=>netSend({t:'tpl',op:'set',id,d:{id,x:0,y:0,size:1}})",gid);await pl.wait_for_timeout(300)
        ok(await gm.evaluate("(()=>{const t=curMap().templates[0];return curMap().templates.length===2&&t.x===700&&t.size===5})()"),"a player can't remove or change someone else's template")
        await pl.keyboard.press("Delete");await pl.wait_for_timeout(300)
        ok(await gm.evaluate("curMap().templates.length")==1,"but removes their own with Delete")
        await gm.evaluate("st.host.playersTemplates=false;Host.lastScene='';save()");await gm.wait_for_timeout(400)
        await mapdrag(pl,"pl",1050,350,1050+4*70,350)
        ok(await gm.evaluate("curMap().templates.length")==1 and await pl.evaluate("Net.scene.templates.length")==1,"the GM can turn players' templates off")
        tid=await gm.evaluate("(()=>{st.host.playersTemplates=true;return Monolith.map.addTemplate({shape:'circle',x:385,y:385,size:10,label:'Frag',color:'#ff4459'})})()")
        x=await gm.evaluate("id=>({n:Monolith.map.caught(id).map(t=>t.label),t:Monolith.map.templates().find(t=>t.id===id),c:window.__caught.slice(-1)[0]})",tid)
        ok(x["n"]==["Wren"] and x["t"]["size"]==5 and x["t"]["fixed"] and x["c"]==["circle",1],"a game places a template from its rules, sized in the map's units")
        await gm.click("[data-act=tpl-clear]");await gm.wait_for_timeout(300)
        ok(await gm.evaluate("curMap().templates.length")==0 and await pl.evaluate("Net.scene.templates.length")==0,"Clear all removes every template for everyone")
        await gm.evaluate("delete GAME.map");await gm.click("[data-act=map-tool][data-t=select]");await pl.click("[data-act=map-tool][data-t=select]")
        ok(await gm.evaluate("appOlder('1.1.9',MONOLITH_VERSION)&&appOlder(undefined,MONOLITH_VERSION)&&!appOlder(MONOLITH_VERSION,MONOLITH_VERSION)&&!appOlder('99.0.0',MONOLITH_VERSION)"),"version comparison for the join check")
        why=await pl.evaluate("""new Promise(res=>{const ws=new WebSocket(Net.url.replace(/^http/i,'ws')+'/ws');
          ws.onopen=()=>ws.send(JSON.stringify({...helloMsg({character:null,peek:true}),app:'1.1.1',playerId:'old-app'}));
          ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.t==='kicked')res(m.reason)};setTimeout(()=>res('no answer'),3000)})""")
        ok("Update Monolith" in why,"a player on an older Monolith is told to update before joining: "+why)
        await gm.click("nav [data-act=tab][data-t=party]");await gm.wait_for_timeout(200)
        ok(await gm.locator(".card:has-text('Wren')").count()==1,"party shows game cards when the game has no party table")
        await gm.evaluate("()=>{ui.rmId=st.party[0].id;ui.modal='remove-pc';renderModal()}");await gm.wait_for_timeout(150)
        await gm.fill("#rm-confirm","Wren");await gm.click("#rm-go");await gm.wait_for_timeout(400)
        ok(await gm.evaluate("st.party.length")==0 and await pl.evaluate("Net.state")=="off","removing a character works without the game's help")
        # a message for a game the GM doesn't play is ignored
        ok(await gm.evaluate("(()=>{try{onMsg('nope',{t:'game',game:'other',type:'x'});return true}catch(e){return false}})()"),"stray game messages are ignored")
        await b.close()
    sys.exit(finish())
asyncio.run(main())
