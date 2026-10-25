/* ============================== MONOLITH GM: START ============================== */
Object.assign(MODALS,{
  host:()=>({title:"Host a game",body:hostModalBody()}),
  "remove-pc":()=>{const c=pc(ui.rmId);if(!c)return null;return {title:`Remove ${charLabel(c)} from the party?`,body:removePcBody(c)}},
  "map-del":()=>{const x=(st.maps||[]).find(y=>y.id===ui.mapDelId);if(!x)return null;return {title:`Delete map "${x.name}"?`,body:mapDelBody(x)}},
  "camp-del":()=>campModal("camp-del"),
  "camp-switch":()=>campModal("camp-switch"),
  "gm-import":()=>campModal("gm-import"),
});
function gmStart(){
  gmLoadCampaign();
  paintFrame();
  campLaunchView();
  Dice.init(campKey(CUR,"rolls"),()=>"GM");
  if(RS.gm&&RS.gm.boot)RS.gm.boot();
  initMapView();
  render();updateStatus();
  hostInit().then(campAfterBoot);
  (async()=>{await Versions.init("monolith-versions-fallback");
    const sc=campScope(CUR);const all=await Versions.listAll(sc);const mine=all[sc]||[];const keys=new Set(mine.map(m=>m.key));
    meta.vlist=[...meta.vlist.filter(m=>!keys.has(m.key)),...mine].sort((a,b)=>b.t-a.t).slice(0,15);requestRender()})();
}
bootGame(gmStart);
