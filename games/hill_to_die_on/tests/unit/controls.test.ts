import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/game/renderer',()=>({Renderer:class {lost=false;resize(){}render(){}dispose(){}}}));
vi.mock('../../src/game/sound',()=>({Sound:class {unlock(){}shot(){}cue(){}pause(){}resume(){}}}));
import { HillShell } from '../../src/shell/HillShell';
import { createHillHarness } from '../../src/shell/harness';

let shell:HillShell,root:HTMLElement;
beforeEach(()=>{
  const entries=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>entries.set(k,v)});
  vi.stubGlobal('requestAnimationFrame',()=>1);vi.stubGlobal('cancelAnimationFrame',()=>undefined);
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  root=document.createElement('div');document.body.append(root);shell=new HillShell(root);
});
afterEach(()=>{shell?.dispose();root?.remove();vi.unstubAllGlobals();});
function click(action:string){const b=root.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`);expect(b).not.toBeNull();b!.click();}
describe('real DOM control wiring (renderer mocked, no visual claim)',()=>{
  it('starts from the shared button, aims with a pointer drag and keeps firing after release',()=>{
    click('start');expect(shell.sim.phase).toBe('combat');
    const zone=root.querySelector<HTMLElement>('.aim-zone')!;
    zone.setPointerCapture=()=>undefined;
    zone.dispatchEvent(new PointerEvent('pointerdown',{pointerId:4,clientX:200,clientY:650,bubbles:true}));
    zone.dispatchEvent(new PointerEvent('pointermove',{pointerId:4,clientX:250,clientY:650,bubbles:true}));
    expect(shell.sim.aim).toBe(0);
    zone.dispatchEvent(new PointerEvent('pointerup',{pointerId:4,bubbles:true}));
    expect(root.querySelector('.stick')!.classList.contains('active')).toBe(false);
    const shots=shell.sim.shots;for(let n=0;n<60;n++)shell.sim.update(1/60);
    expect(shell.sim.shots).toBeGreaterThan(shots);expect(shell.sim.aim).toBe(0);
    click('pause');expect(shell.sim.paused).toBe(true);click('resume');expect(shell.sim.paused).toBe(false);
  });
  it('ignores a second thumb and clears joystick on cancellation',()=>{
    click('start');const zone=root.querySelector<HTMLElement>('.aim-zone')!;zone.setPointerCapture=()=>undefined;
    zone.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,clientX:100,clientY:100}));
    zone.dispatchEvent(new PointerEvent('pointerdown',{pointerId:2,clientX:300,clientY:300}));
    zone.dispatchEvent(new PointerEvent('pointermove',{pointerId:2,clientX:350,clientY:300}));
    expect(shell.sim.aim).toBeCloseTo(-Math.PI/2);
    zone.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1}));expect(root.querySelector('.stick.active')).toBeNull();
  });
  it('equips unlocked weapons and buys a permanent upgrade through menu buttons',()=>{
    click('tab:loadout');click('equip:1');expect(shell.progression.save.playerWeapon).toBe(1);
    shell.progression.bank(1,2,50);click('tab:upgrades');click('upgrade:power');
    expect(shell.progression.save.upgrades.power).toBe(1);expect(shell.progression.save.salvage).toBe(30);
    click('tab:play');click('start');expect(shell.sim.stats.meta.playerWeapon).toBe(1);expect(shell.sim.stats.bonus('damage',1)).toBeCloseTo(.3);
  });
  it('chooses a ranked card through its actual button then starts the next wave',()=>{
    click('start');shell.sim.spawned=shell.sim.spawnTotal;shell.sim.pendingPicks=1;shell.sim.update(1/60);shell.refresh();
    expect(root.querySelectorAll('.upgrade-card')).toHaveLength(3);const offered=shell.sim.cards[1];click('pick:1');
    expect(shell.sim.stats.cards[0]).toEqual(offered);expect(shell.sim.phase).toBe('ready');click('next');expect(shell.sim.wave).toBe(2);
  });
  it('uses bounded harness actions and never fabricates a victory',async()=>{
    const h=createHillHarness(shell,{sha:'test',builtAt:'test',version:'1',dirty:true});
    expect(await h.driveTo('victory')).toBe(false);h.startLevel(1);expect(await h.winLevel()).toBe(false);
    h.verbs.aim.run(0.5);expect(h.snapshot().aim).toBe(.5);expect(h.snapshot().inputReady).toBe(true);
    h.gotoState('pause');expect(h.snapshot().inputReady).toBe(false);expect(h.snapshot().scene).toBe('pause');
  });
});
