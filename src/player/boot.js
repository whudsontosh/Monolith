/* ============================== MONOLITH PLAYER: START ============================== */
function playerStart(){
  lastJoin=Settings.get("lastJoin-"+GAME_INFO.id,{})||{};
  paintFrame();
  Dice.init(`monolith-dice-${GAME_INFO.id}-player`,whoName);
  loadStore();
  if(RS.player&&RS.player.boot)RS.player.boot();
  initPlayerMap();
  render();updateStatus();
  (async()=>{await Versions.init("monolith-versions-fallback");
    const pre=`char:${GAME_INFO.id}:`;const all=await Versions.listAll(pre);
    for(const sc in all){const id=sc.slice(pre.length);const have=S.vmeta[id]||[];const keys=new Set(all[sc].map(m=>m.key));S.vmeta[id]=[...have.filter(m=>!keys.has(m.key)),...all[sc]].sort((a,b)=>b.t-a.t).slice(0,20)}
    requestRender()})();
  resumeJoin();
}
bootGame(playerStart);
