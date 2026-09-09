import { Progression } from '../core/progression';
import { CARD_BASES, CHARACTERS, LEVELS, META_UPGRADES, RANK_COLORS, RANKS, STAT_NAMES, WEAPONS, cardDescription, type MetaKey } from '../game/catalog';
import { Renderer } from '../game/renderer';
import { Simulation } from '../game/simulation';
import { Sound } from '../game/sound';
import { createPerfRecorder } from '@fabrikav2/testkit/harness';
import { publishTourMarker } from '@fabrikav2/testkit/testing';

declare const __BUILD_INFO__: { sha:string; builtAt:string; dirty:boolean };

import { uiCopy } from '../../design/ui-copy';
import { buildButtonElement } from '@fabrikav2/ui';

type Tab = 'play' | 'loadout' | 'upgrades' | 'characters';
const button = (text: string, action: string, extra = ''): string => {
  const element = buildButtonElement({ label: '', onClick: () => undefined, dataAction: action });
  element.innerHTML = text; element.dataset.action = action;
  for (const match of extra.matchAll(/([a-zA-Z][a-zA-Z0-9-]*)(?:="([^"]*)")?/g)) element.setAttribute(match[1], match[2] ?? '');
  return element.outerHTML;
};
export class HillShell {
  readonly sim: Simulation;
  private readonly sound = new Sound();
  private readonly sharedPerf = createPerfRecorder();
  readonly renderer: Renderer;
  readonly canvas: HTMLCanvasElement;
  private readonly hud: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly stick: HTMLElement;
  private tab: Tab = 'play';
  private selectedSlot = -1;
  private selectedLevel = 1;
  private panelKey = '';
  private pointer: number | null = null;
  private originX = 0; private originY = 0;
  private lastFrame = 0; private accumulator = 0; private lastUi = 0;
  private frame = 0;
  private frames = new Float32Array(3600); private costs = new Float32Array(3600); private samples = 0;
  private contextError = false;
  private lastMarker = 0;
  private readonly observer: ResizeObserver;
  constructor(readonly root: HTMLElement, readonly progression = new Progression()) {
    this.sim = new Simulation(progression);
    root.innerHTML = `<main class="hill-app">
      <header class="masthead"><span class="brand-mark">⚑</span><span>THIS IS MY<br><strong>HILL TO DIE ON</strong></span><span class="edition">LAST STAND<br>01 / PROTOTYPE</span></header>
      <section class="hud" aria-label="Run status"></section>
      <div class="arena-wrap"><div class="arena"><div class="terrain-lines"></div><canvas aria-label="Battlefield. You stand in the center." id="battlefield"></canvas><div class="arena-caption"><span>HOLD YOUR GROUND</span><span class="direction">N ↑</span></div></div></div>
      <section class="panel" aria-label="Game menu"></section>
      <section class="controls" aria-label="Aim controls"><div class="control-caption"><span>AUTOFIRE IS ON</span><span>DRAG TO AIM</span></div><div class="aim-zone" aria-label="Aim joystick"><div class="idle-cross">＋</div><div class="stick"><div class="knob"></div></div><span class="aim-hint">Your ground. Your last stand.</span></div><div class="combat-bottom"><span class="weapon-label"></span>${button('Ⅱ', 'pause', 'aria-label="Pause" class="pause-button"')}</div></section>
      <footer class="home-nav">${button('⚑<span>DEPLOY</span>', 'tab:play')}${button('⌖<span>STRONGHOLD</span>', 'tab:loadout')}${button('↟<span>UPGRADES</span>', 'tab:upgrades')}${button('◇<span>CHARACTERS</span>', 'tab:characters')}</footer>
    </main>`;
    this.canvas = root.querySelector('canvas')!; this.hud = root.querySelector('.hud')!;
    this.panel = root.querySelector('.panel')!; this.controls = root.querySelector('.controls')!; this.stick = root.querySelector('.stick')!;
    this.renderer = new Renderer(this.canvas);
    this.observer = new ResizeObserver(() => this.renderer.resize()); this.observer.observe(this.canvas);
    root.addEventListener('click', this.onClick);
    const zone = root.querySelector<HTMLElement>('.aim-zone')!;
    zone.addEventListener('pointerdown', event => {
      if (this.pointer !== null || this.sim.phase !== 'combat' || this.sim.paused) return;
      event.preventDefault(); this.pointer = event.pointerId; this.originX = event.clientX; this.originY = event.clientY;
      zone.setPointerCapture(event.pointerId); const rect = zone.getBoundingClientRect();
      this.stick.style.left = `${event.clientX - rect.left}px`; this.stick.style.top = `${event.clientY - rect.top}px`;
      this.stick.classList.add('active');
    });
    zone.addEventListener('pointermove', event => {
      if (event.pointerId !== this.pointer) return;
      const dx = event.clientX - this.originX, dy = event.clientY - this.originY, distance = Math.hypot(dx, dy);
      if (distance > 5) this.sim.aim = Math.atan2(dy, dx);
      const scale = Math.min(1, 40 / Math.max(1, distance));
      this.stick.querySelector<HTMLElement>('.knob')!.style.transform = `translate(${dx*scale}px,${dy*scale}px)`;
    });
    const release = (event: PointerEvent) => { if (event.pointerId === this.pointer) this.releasePointer(); };
    zone.addEventListener('pointerup', release); zone.addEventListener('pointercancel', release); zone.addEventListener('lostpointercapture', release);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onBackground);
    this.canvas.addEventListener('pointerdown', event => {
      if (this.sim.phase !== 'home' || this.tab !== 'loadout') return;
      const rect = this.canvas.getBoundingClientRect(), x = (event.clientX-rect.left)/rect.width*100-50, y = (event.clientY-rect.top)/rect.height*100-50;
      let best = x*x+y*y, index = -1;
      for (let t = 0; t < 8; t++) { const d = (x-this.sim.towerX[t])**2+(y-this.sim.towerY[t])**2; if (d<best) { best=d; index=t; } }
      this.selectedSlot=index; this.refresh();
    });
    this.refresh(); this.frame = requestAnimationFrame(this.loop);
  }
  private releasePointer(): void {
    this.pointer = null; this.stick.classList.remove('active'); this.stick.querySelector<HTMLElement>('.knob')!.style.transform = '';
  }
  private onBackground = (): void => {
    if (this.sim.phase === 'combat') { this.sim.paused = true; this.releasePointer(); this.sound.pause(); this.refresh(); }
    this.lastFrame = 0; this.accumulator = 0;
  };
  private onVisibility = (): void => { if (document.hidden) this.onBackground(); else { this.lastFrame = 0; this.accumulator = 0; } };
  private onClick = (event: MouseEvent): void => {
    const target = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    if (!target || target.disabled) return;
    this.sound.unlock();
    const [action, value] = target.dataset.action!.split(':'); const n = Number(value);
    const sim = this.sim, save = this.progression.save;
    if (action === 'tab' && sim.phase === 'home') this.tab = value as Tab;
    if (action === 'level' && sim.phase === 'home' && n <= save.unlockedLevel) this.selectedLevel = n;
    if (action === 'start') { sim.start(this.selectedLevel); this.resetPerf(); }
    if (action === 'pause') { sim.paused = true; this.releasePointer(); this.sound.pause(); }
    if (action === 'resume') { sim.paused = false; this.lastFrame = 0; this.sound.resume(); }
    if (action === 'home') { sim.phase = 'home'; sim.paused = false; this.tab = 'play'; this.releasePointer(); sim.enemies.count = 0; sim.bullets.count = 0; sim.effects.count = 0; sim.repair(); }
    if (action === 'next') sim.nextWave();
    if (action === 'pick' && sim.choose(n)) this.sound.cue('pick');
    if (action === 'slot' && sim.phase === 'home') this.selectedSlot = n;
    if (action === 'equip' && sim.phase === 'home') this.progression.equip(this.selectedSlot,n);
    if (action === 'buyweapon' && sim.phase === 'home') this.progression.purchase('weapon', n);
    if (action === 'character' && sim.phase === 'home') {
      if (save.characters.includes(n)) this.progression.selectCharacter(n);
      else this.progression.purchase('character',n);
    }
    if (action === 'upgrade' && sim.phase === 'home') this.progression.purchase(value as MetaKey);
    this.refresh();
  };
  refresh(): void { this.panelKey = ''; this.renderUi(); }
  private renderUi(): void {
    const sim = this.sim, save = this.progression.save, home = sim.phase === 'home';
    this.root.classList.toggle('at-home',home); this.root.classList.toggle('in-combat',sim.phase === 'combat' && !sim.paused);
    this.root.querySelector('.home-nav')!.classList.toggle('hidden',!home);
    this.controls.classList.toggle('hidden',sim.phase !== 'combat' || sim.paused);
    this.root.querySelector('.weapon-label')!.textContent = `${WEAPONS[sim.stats.meta.playerWeapon].icon} ${WEAPONS[sim.stats.meta.playerWeapon].name}`;
    if (home) this.hud.innerHTML = `<div><span class="eyebrow">YOUR STRONGHOLD</span><strong>${CHARACTERS[save.character].name}</strong></div><div class="salvage"><span class="eyebrow">SALVAGE</span><strong>◇ ${save.salvage}</strong></div>`;
    else this.hud.innerHTML = `<div class="wave-info"><span class="eyebrow">${LEVELS[sim.level-1]}</span><strong>WAVE ${String(sim.wave).padStart(2,'0')} <small>/ 10</small></strong></div><div class="health"><span>HILL <b>${Math.ceil(sim.hp)}</b></span><div class="meter"><i style="width:${sim.hp/sim.maxHp*100}%"></i></div></div><div class="xp-row"><span>LV ${sim.rank}</span><div class="meter xp"><i style="width:${sim.xp/sim.xpNeeded*100}%"></i></div><span>${sim.kills} KILLS</span></div>`;
    const key = `${sim.phase}/${sim.paused}/${this.tab}/${this.selectedSlot}/${this.selectedLevel}/${save.salvage}/${save.character}/${save.playerWeapon}/${save.layout.join(',')}/${sim.pendingPicks}/${sim.stats.cards.length}`;
    if (key === this.panelKey) return;
    this.panelKey = key; this.panel.classList.toggle('hidden',sim.phase === 'combat' && !sim.paused);
    this.root.querySelectorAll<HTMLButtonElement>('.home-nav button').forEach(b => b.classList.toggle('selected',b.dataset.action === `tab:${this.tab}`));
    if (home) { this.renderHome(); return; }
    if (sim.paused) {
      this.panel.innerHTML = `<div class="sheet-heading"><span class="eyebrow">TAKE A BREATH</span><h2>Still your hill.</h2></div><div class="stats-grid">${(['damage','rate','area','xp','luck','crit','health'] as const).map(stat => `<div><span>${STAT_NAMES[stat]}</span><b>+${Math.round(sim.stats.bonus(stat,sim.stats.meta.playerWeapon)*(stat === 'luck' ? 1 : 100))}${stat === 'luck' ? '' : '%'}</b></div>`).join('')}</div><p>${sim.stats.cards.length} upgrades this run · ${sim.earned} salvage banked</p>${button(uiCopy.keepFiring,'resume','class="primary"')}${button(uiCopy.endRun,'home','class="quiet"')}`;
    } else if (sim.phase === 'cards') {
      this.panel.innerHTML = `<div class="sheet-heading"><span class="eyebrow">WAVE ${sim.wave} CLEARED · +${sim.reward} SALVAGE</span><h2>Make your stand stronger.</h2><p>Choose an upgrade · ${sim.pendingPicks} ${sim.pendingPicks === 1 ? 'pick' : 'picks'} remaining</p></div><div class="card-list">${sim.cards.map((card,i) => button(`<span class="card-rank" style="color:${RANK_COLORS[card.rank]}">${RANKS[card.rank]} · ${'◆'.repeat(card.rank+1)}</span><strong>${card.name}</strong><span>${cardDescription(card)}</span>`,`pick:${i}`,`class="upgrade-card" style="--rarity:${RANK_COLORS[card.rank]}"`)).join('')}</div>`;
    } else if (sim.phase === 'ready') {
      this.panel.innerHTML = `<div class="sheet-heading"><span class="eyebrow">+${sim.reward} SALVAGE BANKED</span><h2>They’ll be back.</h2><p>Towers and walls repaired. Hill restored by 15.</p></div><div class="wave-track">${Array.from({length:10},(_,i)=>`<i class="${i<sim.wave?'cleared':''}">${i+1}</i>`).join('')}</div><p>${sim.stats.cards.length} ${sim.stats.cards.length === 1 ? 'upgrade' : 'upgrades'} · next attack from ${['NORTH','EAST','SOUTH','WEST'][sim.wave%4]}</p>${button(`Defend wave ${sim.wave+1} →`,'next','class="primary"')}${button(uiCopy.returnHome,'home','class="quiet"')}`;
    } else {
      const won = sim.phase === 'victory';
      this.panel.innerHTML = `<div class="sheet-heading"><span class="eyebrow">${won?'LEVEL SECURED':uiCopy.defeatKicker}</span><h2>${won?uiCopy.victoryTitle:uiCopy.defeatTitle}</h2><p>${won && sim.level===1?uiCopy.levelUnlocked:`You reached wave ${sim.wave} of 10.`}</p></div><div class="result-stats"><div><b>${sim.kills}</b><span>ENEMIES DOWN</span></div><div><b>◇ ${sim.earned}</b><span>SALVAGE KEPT</span></div></div><p>Spend salvage on weapons, characters, and your stronghold.</p>${button(uiCopy.backHome,'home','class="primary"')}`;
    }
    this.panel.scrollTop = 0;
  }
  private renderHome(): void {
    const save = this.progression.save;
    if (this.tab === 'play') {
      this.panel.innerHTML = `<div class="sheet-heading"><span class="eyebrow">ONE HILL. NO RETREAT.</span><h1>This is my<br><em>hill to die on.</em></h1></div><div class="level-selector">${LEVELS.map((name,i)=>button(`<span>0${i+1}</span><strong>${name}</strong><small>${save.unlockedLevel>i?`BEST ${save.best[i]}/10`:'LOCKED'}</small>`,`level:${i+1}`,`class="level-choice ${this.selectedLevel===i+1?'selected':''}" ${save.unlockedLevel<=i?'disabled':''}`)).join('')}</div><p class="instructions">Aim with one thumb. Always firing.<br>Survive 10 waves. Fall, upgrade, try again.</p>${button(uiCopy.start,'start','class="primary"')}`;
    } else if (this.tab === 'loadout') {
      const current = this.selectedSlot<0 ? save.playerWeapon : save.layout[this.selectedSlot];
      const others = save.layout.filter((_,i) => i !== this.selectedSlot);
      const towerFull = this.selectedSlot >= 0 && others.filter(n => n >= 0).length >= 1 + save.upgrades.towers;
      const wallFull = others.filter(n => n === -1).length >= 2;
      this.panel.innerHTML = `<div class="sheet-heading"><span class="eyebrow">DESIGN YOUR DEFENSE</span><h2>${this.selectedSlot<0?'Your weapon':`Position ${this.selectedSlot+1}`}</h2><p>${save.layout.filter(n=>n>=0).length}/${1+save.upgrades.towers} towers · ${save.layout.filter(n=>n===-1).length}/2 walls. Tap a slot to equip.</p></div><div class="slot-selector">${button('YOU','slot:-1',`class="${this.selectedSlot===-1?'selected':''}"`)}${save.layout.map((_,i)=>button(`${i+1}`,`slot:${i}`,`class="${this.selectedSlot===i?'selected':''}"`)).join('')}</div><div class="equipment-list">${WEAPONS.map((w,i) => {
        const owned=save.weapons.includes(i);
        return button(`<span class="weapon-icon">${w.icon}</span><span><strong>${w.name}</strong><small>${w.tags.join(' + ')}</small><small>${w.description}</small></span><b>${current===i?'✓':owned?(towerFull?'TOWER LIMIT':'EQUIP'):`◇ ${w.cost}`}</b>`,`${owned?'equip':'buyweapon'}:${i}`,`class="equipment ${current===i?'selected':''}" ${owned?towerFull?'disabled':'':save.salvage<w.cost?'disabled':''}`);
      }).join('')}${this.selectedSlot>=0?button('▰ Wall section','equip:-1',`class="equipment ${current===-1?'selected':''}" ${wallFull?'disabled':''}`)+button('Empty this position','equip:-2','class="quiet"'):''}</div>`;
    } else if (this.tab === 'upgrades') {
      this.panel.innerHTML = `<div class="sheet-heading"><span class="eyebrow">EVERY ATTEMPT COUNTS</span><h2>Come back stronger.</h2><p>Permanent upgrades. Kept after every defeat.</p></div><div class="equipment-list">${META_UPGRADES.map(u=> {
        const rank=save.upgrades[u.key], cost=u.base*(rank+1), max=rank>=u.max;
        return button(`<span><strong>${u.name}</strong><small>${u.text}</small><small>RANK ${rank} / ${u.max}</small></span><b>${max?'MAX':`◇ ${cost}`}</b>`,`upgrade:${u.key}`,`class="equipment" ${max||save.salvage<cost?'disabled':''}`);
      }).join('')}</div>`;
    } else {
      this.panel.innerHTML = `<div class="sheet-heading"><span class="eyebrow">WHO HOLDS THE HILL?</span><h2>Choose your holdout.</h2></div><div class="equipment-list">${CHARACTERS.map((c,i)=> {
        const owned=save.characters.includes(i);
        return button(`<span class="character-token" style="--hero:${c.color}">${['⚑','≋','⌘'][i]}</span><span><strong>${c.name}</strong><small>${c.passive}</small><small>Starts with ${WEAPONS[c.weapon].name}</small></span><b>${save.character===i?'✓':owned?'SELECT':`◇ ${c.cost}`}</b>`,`character:${i}`,`class="equipment ${save.character===i?'selected':''}" ${!owned&&save.salvage<c.cost?'disabled':''}`);
      }).join('')}</div>`;
    }
    this.panel.scrollTop = 0;
  }
  private loop = (now: number): void => {
    if (!document.hidden) {
      const start = performance.now(), elapsed = this.lastFrame ? now-this.lastFrame : 1000/60; this.lastFrame = now;
      this.accumulator += Math.min(.1, elapsed/1000);
      let steps=0; const oldShots=this.sim.shots, oldPhase=this.sim.phase;
      while (this.accumulator >= 1/60 && steps<6) { this.sim.update(1/60); this.accumulator-=1/60; steps++; }
      if (this.sim.shots>oldShots) this.sound.shot(now);
      if (oldPhase==='combat' && this.sim.phase==='cards') this.sound.cue('wave');
      if (this.renderer.lost && !this.contextError) {
        this.contextError = true; this.sim.paused = true; this.panel.innerHTML=uiCopy.graphicsError; this.panel.classList.remove('hidden');
      }
      if (!this.contextError) {
        this.renderer.render(this.sim,this.sim.phase==='home'&&this.tab==='loadout'?this.selectedSlot:-3);
        if (now-this.lastUi>100) { this.renderUi(); this.lastUi=now; }
      }
      if (this.sim.phase==='combat' && !this.sim.paused) {
        const slot=this.samples++%this.frames.length; this.frames[slot]=elapsed; this.costs[slot]=performance.now()-start; this.sharedPerf.record(elapsed);
      }
      if (import.meta.env.VITE_ENABLE_TEST_HARNESS === 'true' && now-this.lastMarker>2000) {
        this.lastMarker=now;
        publishTourMarker(`${this.sim.paused?'pause':this.sim.phase};${JSON.stringify({ ...this.sim.snapshot(), save:this.progression.save, profile:this.progression.storageKey.endsWith('.device-qa')?'qa':'player', perf:this.perf(), build:__BUILD_INFO__ })}`, {publishMetrics:false});
      }
    }
    this.frame=requestAnimationFrame(this.loop);
  };
  resetPerf(): void { this.samples=0; this.sharedPerf.reset(); }
  perf() {
    const count=Math.min(this.samples,this.frames.length);
    const times=Array.from(this.frames.subarray(0,count)).sort((a,b)=>a-b);
    const costs=Array.from(this.costs.subarray(0,count)).sort((a,b)=>a-b);
    const percentile=(values:number[],q:number)=>values[Math.min(values.length-1,Math.floor(values.length*q))]??0;
    return { ...this.sharedPerf.sample(), frames:count, medianFrameMs:percentile(times,.5), p95FrameMs:percentile(times,.95), p99FrameMs:percentile(times,.99), p95CpuMs:percentile(costs,.95), over33ms:times.filter(t=>t>33.4).length,
      enemies:this.sim.enemies.count, peakEnemies:this.sim.peakEnemies, drawCalls:1, dpr:Math.min(2,devicePixelRatio), cardDefinitions:CARD_BASES.length };
  }
  dispose(): void {
    cancelAnimationFrame(this.frame); this.observer.disconnect(); this.renderer.dispose();
    document.removeEventListener('visibilitychange',this.onVisibility); window.removeEventListener('pagehide',this.onBackground); this.root.removeEventListener('click',this.onClick);
  }
}
