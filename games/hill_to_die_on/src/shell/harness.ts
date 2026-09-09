import { wrapSnapshot, type GameHarness } from '@fabrikav2/testkit/harness';
import { defaultSave, validSave } from '../core/progression';
import type { HillShell } from './HillShell';

type Verb = 'aim' | 'choose' | 'next' | 'stress';
export function createHillHarness(shell: HillShell, build: {sha:string;builtAt:string;version:string;dirty:boolean}) {
  const sim = shell.sim, progression = shell.progression;
  const click = (action:string):void => { shell.root.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)?.click(); };
  const gotoState = (state:string):void => {
    if(state===sim.phase || (state==='pause'&&sim.paused))return;
    if(state==='home'){sim.phase='home';sim.paused=false;sim.enemies.count=0;sim.bullets.count=0;sim.effects.count=0;sim.repair();}
    else if(state==='combat'){if(sim.phase==='home')sim.start();else if(sim.paused)click('resume');else if(sim.phase==='ready')sim.nextWave();else throw new Error('Finish the current draft or run first.');}
    else if(state==='pause'&&sim.phase==='combat')click('pause');
    else throw new Error(`State ${state} must be earned through combat; no fabricated outcomes.`);
    shell.refresh();
  };
  const snapshot = () => ({ ...sim.snapshot(), scene:sim.paused?'pause':sim.phase,
    status:sim.paused?'paused':sim.phase==='combat'?'playing':sim.phase==='victory'?'won':sim.phase==='defeat'?'lost':'idle',
    inputReady:sim.phase==='combat'&&!sim.paused, build, save:structuredClone(progression.save),
    viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio} });
  const harness = {
    gotoState, snapshot,
    snapshotEnvelope:()=>wrapSnapshot(snapshot(),{buildVersion:build.builtAt,packageId:'com.basegamelab.hilltodieon'}),
    startLevel:(level:number)=>{sim.start(level);shell.resetPerf();shell.refresh();},
    sagaNodes:()=>Array.from({length:progression.save.unlockedLevel},(_,i)=>i+1),
    unlockAll:()=>{progression.save.unlockedLevel=2;progression.save.weapons=[0,1,2,3];progression.save.characters=[0,1,2];progression.persist();shell.refresh();},
    grantCoins:(amount:number)=>{if(Number.isSafeInteger(amount)&&amount>=0){progression.save.salvage=Math.min(1e9,progression.save.salvage+amount);progression.persist();shell.refresh();}},
    resetSave:()=>{progression.save=defaultSave();progression.persist();gotoState('home');shell.refresh();},
    seedSave:(profile:Record<string,unknown>)=>{if(!validSave(profile))throw new Error('A complete valid hill save is required.');progression.save=structuredClone(profile) as ReturnType<typeof defaultSave>;progression.persist();gotoState('home');shell.refresh();},
    // Cooperative goal steps: one bounded input per call. The external agent
    // owns repetition and observes each result; these never run hidden loops.
    winLevel:async()=>{
      if(sim.phase==='cards')sim.choose(0);
      else if(sim.phase==='ready')sim.nextWave();
      else if(sim.phase==='combat'){
        const i=sim.grid.nearest(sim.enemies,0,0,85);
        if(i>=0)sim.aim=Math.atan2(sim.enemies.y[i],sim.enemies.x[i]);
      }
      shell.refresh();return sim.phase==='victory';
    },
    failLevel:async()=>{
      if(sim.phase==='combat'){
        const i=sim.grid.nearest(sim.enemies,0,0,85);
        if(i>=0)sim.aim=Math.atan2(sim.enemies.y[i],sim.enemies.x[i])+Math.PI;
      }else if(sim.phase==='cards')sim.choose(0);else if(sim.phase==='ready')sim.nextWave();
      shell.refresh();return sim.phase==='defeat';
    },
    driveTo:async(state:string)=>{try{gotoState(state);return state===snapshot().scene;}catch{return false;}},
    perf:()=>shell.perf(),resetPerf:()=>shell.resetPerf(),
    verbs:{
      aim:{run:(...args:readonly unknown[])=>{const angle=Number(args[0]);if(Number.isFinite(angle))sim.aim=angle;}},
      choose:{run:(...args:readonly unknown[])=>{const ok=sim.choose(Number(args[0]));shell.refresh();return ok;}},
      next:{run:()=>{const ok=sim.nextWave();shell.refresh();return ok;}},
      stress:{run:(...args:readonly unknown[])=>{const count=Number(args[0]);if(Number.isFinite(count)){sim.stressScene(count);shell.resetPerf();shell.refresh();}}},
    },
  } satisfies GameHarness<Verb> & {snapshotEnvelope:()=>unknown;resetPerf:()=>void};
  return harness;
}
