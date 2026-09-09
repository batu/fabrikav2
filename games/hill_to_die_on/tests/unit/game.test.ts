import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '@fabrikav2/kernel';
import { defaultSave, Progression, RunStats, SAVE_KEY, validSave } from '../../src/core/progression';
import { Pool, Simulation, SpatialGrid } from '../../src/game/simulation';
import { WEAPONS } from '../../src/game/catalog';

beforeEach(() => {
  const entries = new Map<string,string>();
  vi.stubGlobal('localStorage', { getItem: (key:string) => entries.get(key) ?? null, setItem: (key:string,value:string) => entries.set(key,value), clear: () => entries.clear(), removeItem: (key:string) => entries.delete(key) });
});
function advance(sim: Simulation, seconds: number): void { for (let t=0;t<seconds*60;t++) sim.update(1/60); }
function enemy(sim: Simulation,x:number,y:number,hp=10): number {
  sim.spawnEnemy(); const i=sim.enemies.count-1; sim.enemies.x[i]=x; sim.enemies.y[i]=y; sim.enemies.hp[i]=hp; sim.enemies.vx[i]=0; return i;
}
describe('persistent progression',()=>{
  it('rejects corrupt saves and survives a reload after purchases and placements',()=>{
    localStorage.setItem(SAVE_KEY,'{"version":1,"salvage":-100}');
    const p=new Progression(); expect(p.save).toEqual(defaultSave());
    p.bank(1,3,200); expect(p.purchase('towers')).toBe(true); expect(p.purchase('weapon',2)).toBe(true);
    expect(p.equip(4,2)).toBe(true); expect(p.equip(5,2)).toBe(false); expect(p.equip(0,-2)).toBe(true); expect(p.equip(5,2)).toBe(true);
    expect(new Progression().save).toEqual(p.save); expect(p.save.salvage).toBe(100); expect(validSave(p.save)).toBe(true);
  });
  it('does not overspend, buy twice, or equip a locked weapon',()=>{
    const p=new Progression(); expect(p.purchase('power')).toBe(false); expect(p.equip(-1,3)).toBe(false);
    p.bank(1,1,55); expect(p.purchase('weapon',2)).toBe(true); expect(p.purchase('weapon',2)).toBe(false); expect(p.save.salvage).toBe(0);
    expect(p.purchase('character',99)).toBe(false); expect(p.equip(0,NaN)).toBe(false);
  });
  it('unlocks the next level only after wave ten and retains the prior best',()=>{
    const p=new Progression(); p.bank(1,9,10); expect(p.save.unlockedLevel).toBe(1);
    p.bank(1,10,10); p.bank(1,1,10); expect(new Progression().save.unlockedLevel).toBe(2); expect(p.save.best[0]).toBe(10);
  });
  it('characters equip their starting weapon and keep their passive distinct',()=>{
    const p=new Progression(); p.bank(1,1,200); p.purchase('character',1); expect(p.selectCharacter(1)).toBe(true);
    expect(p.save.playerWeapon).toBe(1); const stats=new RunStats(p.save); expect(stats.bonus('damage',1)).toBe(.35); expect(stats.bonus('damage',0)).toBe(0);
  });
});
describe('card rules',()=>{
  it('stacks both tags, global and weapon-specific damage without affecting other weapons',()=>{
    const stats=new RunStats(defaultSave());
    stats.cards=[
      {id:'a',name:'a',scope:'all',stat:'damage',rank:0,amount:.1},
      {id:'b',name:'b',scope:'kinetic',stat:'damage',rank:0,amount:.2},
      {id:'c',name:'c',scope:'bullet',stat:'damage',rank:0,amount:.3},
      {id:'d',name:'d',scope:0,stat:'damage',rank:0,amount:.4},
    ];
    expect(stats.bonus('damage',0)).toBeCloseTo(1.2); expect(stats.bonus('damage',1)).toBeCloseTo(.3); expect(stats.bonus('damage',3)).toBeCloseTo(.5);
  });
  it('offers three distinct relevant cards and luck improves rarity for the same RNG stream',()=>{
    const a=new RunStats(defaultSave()), b=new RunStats(defaultSave()); b.meta.upgrades.fortune=5;
    const r1=mulberry32(123),r2=mulberry32(123); let normal=0,lucky=0;
    for(let n=0;n<500;n++) {
      const cards=a.draft(r1), boosted=b.draft(r2); expect(new Set(cards.map(c=>c.id)).size).toBe(3);
      cards.forEach((c,i)=> { expect(c.scope==='all'||c.scope===0||WEAPONS[0].tags.some(t=>t===c.scope)).toBe(true); normal+=c.rank; lucky+=boosted[i].rank; });
    }
    expect(lucky).toBeGreaterThan(normal);
  });
});
describe('combat and wave lifecycle',()=>{
  it('a health card raises current and maximum health, repairs respect it, and a new run resets it',()=>{
    const sim=new Simulation(new Progression(),1); sim.start(); sim.hp=70;
    sim.phase='cards';sim.pendingPicks=1;sim.cards=[{id:'health',name:'Dig in',stat:'health',scope:'all',rank:0,amount:.12}];
    expect(sim.choose(0)).toBe(true);expect(sim.maxHp).toBe(112);expect(sim.hp).toBe(82);
    sim.nextWave();sim.spawned=sim.spawnTotal;sim.update(1/60);expect(sim.hp).toBeCloseTo(97);
    sim.start();expect(sim.maxHp).toBe(100);expect(sim.hp).toBe(100);
  });
  it('fires without input, retains aim, and pauses without changing combat',()=>{
    const sim=new Simulation(new Progression(),1); sim.start(); sim.aim=.3; advance(sim,1);
    expect(sim.shots).toBeGreaterThan(5); expect(sim.aim).toBe(.3); sim.paused=true;
    const before=sim.snapshot(); advance(sim,1); expect(sim.snapshot()).toEqual(before);
  });
  it.each([0,1,2,3])('weapon %i damages enemies using its real firing path',weapon=>{
    const p=new Progression(); p.save.playerWeapon=weapon; p.save.layout.fill(-2);
    const sim=new Simulation(p,1); sim.start(); sim.stress=true; sim.aim=0;
    enemy(sim,15,0,100); advance(sim,1.5); expect(sim.enemies.count===0||sim.enemies.hp[0]<100).toBe(true);
  });
  it('towers aim independently and structures block enemies before the hill',()=>{
    const sim=new Simulation(new Progression(),1); sim.start(); sim.stress=true; sim.aim=Math.PI/2;
    enemy(sim,0,-23,60); advance(sim,1); expect(sim.enemies.hp[0]).toBeLessThan(60); expect(sim.towerAngle[0]).toBeCloseTo(-Math.PI/2);
    sim.stress=false; sim.spawned=sim.spawnTotal; sim.enemies.count=0; enemy(sim,0,-15,1000);
    advance(sim,1); expect(sim.towerHp[0]).toBeLessThan(90); expect(sim.hp).toBe(100);
  });
  it('converts earned levels into picks at the boundary, repairs towers and banks each wave once',()=>{
    const p=new Progression(),sim=new Simulation(p,7); sim.start(); sim.spawned=sim.spawnTotal; sim.pendingPicks=2;
    sim.hp=70; sim.towerHp[0]=0; sim.update(1/60);
    expect(sim.phase).toBe('cards'); expect(sim.hp).toBe(85); expect(sim.towerHp[0]).toBe(90); expect(p.save.salvage).toBe(15);
    advance(sim,2); expect(p.save.salvage).toBe(15); expect(sim.choose(8)).toBe(false);
    sim.choose(0); expect(sim.phase).toBe('cards'); sim.choose(0); expect(sim.phase).toBe('ready');
    expect(sim.nextWave()).toBe(true); expect(sim.wave).toBe(2); expect(sim.stats.cards.length).toBe(2);
  });
  it('completes ten boundaries, persists level two, resets run cards on retry',()=>{
    const p=new Progression(),sim=new Simulation(p,2); expect(sim.start(2)).toBe(false); sim.start();
    for(let wave=1;wave<=10;wave++) { sim.spawned=sim.spawnTotal; sim.update(1/60); expect(sim.wave).toBe(wave); if(wave<10) sim.nextWave(); }
    expect(sim.phase).toBe('victory'); expect(p.save.unlockedLevel).toBe(2); expect(sim.nextWave()).toBe(false);
    expect(sim.start(2)).toBe(true); expect(sim.wave).toBe(1); expect(sim.stats.cards).toEqual([]); expect(p.save.salvage).toBeGreaterThan(200);
  });
  it('loss preserves banked salvage and restarts at wave one',()=>{
    const p=new Progression(),sim=new Simulation(p,2); p.bank(1,2,30); sim.start(); sim.hp=.01; sim.stats.meta.layout.fill(-2);
    enemy(sim,0,-2,1000); advance(sim,.1); expect(sim.phase).toBe('defeat'); expect(new Progression().save.salvage).toBe(30);
    sim.start(); expect(sim.hp).toBe(100); expect(sim.wave).toBe(1);
  });
  it('pools stay bounded and grid matches brute-force nearest results',()=>{
    const pool=new Pool(100),rng=mulberry32(98),grid=new SpatialGrid();
    for(let n=0;n<100;n++){const i=pool.add();pool.x[i]=rng()*100-50;pool.y[i]=rng()*100-50;pool.hp[i]=1;}
    expect(pool.add()).toBe(-1);grid.rebuild(pool);
    for(let n=0;n<20;n++){const x=rng()*80-40,y=rng()*80-40;let best=-1,d=400;
      for(let i=0;i<pool.count;i++){const dd=(pool.x[i]-x)**2+(pool.y[i]-y)**2;if(dd<d){d=dd;best=i;}}
      expect(grid.nearest(pool,x,y,20)).toBe(best);
    }
  });
});
