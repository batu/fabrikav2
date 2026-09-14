(async function(){
 try {
  const H=window.__FIND_DOG_HARNESS__, S=window.__FIND_DOG_STATE__;
  const B='http://192.168.1.98:5321';
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const BL=window.__BL=window.__BL||{events:[],log:[],phase:'init'};
  const flag=(want,why)=>{try{fetch(B+'/flag',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({want,why,t:Date.now()})}).catch(()=>{});}catch(e){}};
  const post=(o)=>{try{fetch(B+'/result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(o)}).catch(()=>{});}catch(e){}};
  const drain=()=>{for(const e of H.drainEvents()) BL.events.push({t:Date.now(),name:e.name,params:e.params});};
  if(!BL.timer) BL.timer=setInterval(drain,400);
  const mark=(m)=>{const row={t:Date.now(),m};BL.log.push(row);console.log('[drive] '+m);post({id:'drive-log',t:row.t,m});};
  const snap=()=>H.snapshot();
  const waitFor=async(pred,label,ms=30000)=>{const t0=Date.now();while(Date.now()-t0<ms){try{if(pred())return true;}catch(e){}await sleep(200);}mark('TIMEOUT '+label+' snap='+JSON.stringify(compact(snap())));return false;};
  const compact=(s)=>({scene:s.activeScene,levelId:s.levelId,dogs:(s.dogPositions||[]).length,found:(s.foundDogIds||[]).length,lc:s.levelCompleteOverlayVisible,actions:s.completionActionsVisible,susp:s.lifecycleSuspended});
  const q=(sel)=>document.querySelector(sel);
  const clickWhenEnabled=async(sel,label,ms=45000)=>{const ok=await waitFor(()=>{const b=q(sel);return b&&!b.disabled&&!b.hidden&&b.offsetParent!==null;},label,ms);if(!ok)return false;q(sel).click();mark('clicked '+label);return true;};
  const btnState=()=>['.fab-complete-claim-btn','.fab-complete-claim-x2-btn','.fab-complete-next-btn'].map(s=>{const b=q(s);return s.replace('.fab-complete-','')+':'+(b?(b.disabled?'disabled':'enabled')+(b.hidden?'/hidden':''):'absent');}).join(' ');
  const playLevel=async(n,opts)=>{
    BL.phase='level'+n;
    const loaded=await waitFor(()=>{const s=snap();return s.activeScene==='GameScene'&&s.levelId&&(s.dogPositions||[]).length>0&&!s.levelCompleteOverlayVisible;},'level '+n+' loaded',120000);
    if(!loaded) return false;
    await sleep(1500);
    const s0=snap(); const levelId=s0.levelId; const ids=s0.dogPositions.map(d=>d.id);
    mark('level '+n+' id='+levelId+' idx='+S.currentLevelIndex+' birds='+ids.length+' sessionDone='+S.levelsCompletedThisSession);
    for(const id of ids){const r=H.findDog(id);await sleep(650);if(!r.found)mark('find miss '+id);}
    const lc=await waitFor(()=>snap().levelCompleteOverlayVisible===true,'level '+n+' complete overlay',60000);
    if(!lc) return false;
    mark('level '+n+' complete overlay visible; '+btnState());
    if(opts&&opts.background){await sleep(1200);mark('backgrounding on completion screen');await H.setLifecycleForTest('inactive');await sleep(1500);H.setLifecycleForTest('active');mark('resumed');}
    await waitFor(()=>{const o=document.getElementById('level-complete-overlay');return !!o&&o.dataset.rewardReveal==='complete';},'reward reveal L'+n,30000);
    if(!await clickWhenEnabled('.fab-complete-claim-btn','claim L'+n)) return false;
    await sleep(300); mark('after claim: '+btnState());
    flag(true,'next L'+n);
    if(!await clickWhenEnabled('.fab-complete-next-btn','next L'+n)) { flag(false,'next failed'); return false; }
    const tNext=Date.now();
    const nxt=await waitFor(()=>{const s=snap();return s.activeScene==='GameScene'&&s.levelId&&s.levelId!==levelId&&(s.dogPositions||[]).length>0;},'level '+(n+1)+' after next',150000);
    flag(false,'level '+(n+1)+' reached='+nxt);
    mark('after next L'+n+': '+(nxt?'next level up':'no next level')+' in '+(Date.now()-tNext)+' ms; '+JSON.stringify(compact(snap())));
    return nxt;
  };
  // ---- phase 2: muted ads (session completions 4..6) + abandon proof ----
  BL.events=[]; BL.log=[]; BL.phase='ads-off';
  H.setSettings({adsEnabled:false}); mark('adsEnabled=false idx='+S.currentLevelIndex+' sessionDone='+S.levelsCompletedThisSession);
  const results={};
  for(let n=4;n<=6;n++){results['M'+n]=await playLevel(n,{});if(!results['M'+n])break;}
  BL.phase='abandon';
  const loaded=await waitFor(()=>{const s=snap();return s.activeScene==='GameScene'&&s.levelId&&(s.dogPositions||[]).length>0&&!s.levelCompleteOverlayVisible;},'level 7 loaded',60000);
  if(loaded){await sleep(1500);const s0=snap();const ids=s0.dogPositions.map(x=>x.id).slice(0,3);for(const id of ids){H.findDog(id);await sleep(650);}
    mark('level 7 '+s0.levelId+' found 3 of '+s0.dogPositions.length+'; backgrounding mid-level');
    await H.setLifecycleForTest('inactive');await sleep(1500);H.setLifecycleForTest('active');mark('resumed mid-level');await sleep(800);
    mark('going home mid-level'); await H.gotoHomeForTest(); await sleep(2500); mark('home: '+JSON.stringify(compact(snap())));}
  await sleep(2000); drain(); BL.phase='done2';
  const summary=BL.events.map(e=>({t:e.t,name:e.name,p:Object.fromEntries(Object.entries(e.params).filter(([k])=>!['game','platform','build','app_version','environment'].includes(k)))}));
  post({id:'drive-events2',ok:true,value:summary});
  return {results,events:summary.length,log:BL.log};
 } catch(e){ const m='DRIVE ERROR '+(e&&e.name)+': '+(e&&e.message)+' | '+String(e&&e.stack).slice(0,400); console.log(m); try{fetch('http://192.168.1.98:5321/result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'drive-error',m:m,t:Date.now(),phase:(window.__BL||{}).phase})});}catch(_){} return {error:m}; }
})()
