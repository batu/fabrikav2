import { createAudioBus, type AudioBus } from '@fabrikav2/sdk/audio';

/** Short voices use the shared mixer. No music/assets/network or per-enemy voices. */
export class Sound {
  private bus: AudioBus | null = null;
  private lastShot = 0;
  unlock(): void {
    try {
      if (!this.bus) {
        this.bus = createAudioBus(); this.bus.setVolume('sfx', .14);
        for (const [id, frequency, duration] of [['shot',180,.035],['pick',720,.11],['wave',440,.25]] as const) {
          this.bus.register(id,{kind:'voice',render(ctx,out){
            const osc=ctx.createOscillator(),gain=ctx.createGain(),start=ctx.currentTime;
            osc.type=id==='shot'?'triangle':'sine';osc.frequency.setValueAtTime(frequency,start);osc.frequency.exponentialRampToValueAtTime(frequency*(id==='shot'?.3:1.8),start+duration);
            gain.gain.setValueAtTime(.5,start);gain.gain.exponentialRampToValueAtTime(.001,start+duration);
            osc.connect(gain);gain.connect(out);osc.start(start);osc.stop(start+duration);
            osc.onended=()=>{osc.disconnect();gain.disconnect();};
            return {stop(){try{osc.stop();}catch{/* already stopped */}}};
          }});
        }
      }
      void this.bus.unlock().catch(()=>undefined);
    } catch { /* Audio availability never prevents combat. */ }
  }
  shot(now:number):void { if(this.bus&&now-this.lastShot>100){this.lastShot=now;this.bus.play('shot',{channel:'sfx'});} }
  cue(id:'pick'|'wave'):void { this.bus?.play(id,{channel:'sfx'}); }
  pause():void { this.bus?.suspend(); }
  resume():void { void this.bus?.resume().catch(()=>undefined); }
}
