import { WEAPONS } from './catalog';
import { Simulation, ENEMY_CAP, BULLET_CAP } from './simulation';

const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPosition;
layout(location=1) in vec2 aSize;
layout(location=2) in float aAngle;
layout(location=3) in vec4 aColor;
layout(location=4) in float aShape;
out vec2 uv; out vec4 color; flat out int shape;
void main() {
  vec2 corners[6] = vec2[6](vec2(-1,-1),vec2(1,-1),vec2(-1,1),vec2(-1,1),vec2(1,-1),vec2(1,1));
  uv = corners[gl_VertexID];
  vec2 p = uv * aSize;
  float c=cos(aAngle),s=sin(aAngle);
  vec2 world=aPosition+vec2(p.x*c-p.y*s,p.x*s+p.y*c);
  gl_Position=vec4(world.x/50.,-world.y/50.,0.,1.);
  color=aColor; shape=int(aShape);
}`;
const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 uv; in vec4 color; flat in int shape; out vec4 frag;
void main() {
  float d=length(uv);
  if(shape==0 && d>1.) discard;
  if(shape==1 && max(abs(uv.x),abs(uv.y))>.82 && length(max(abs(uv)-.82,0.))>.18) discard;
  if(shape==2 && abs(uv.x)+abs(uv.y)>1.25) discard;
  if(shape==3 && (uv.x<-.95 || abs(uv.y)>(uv.x+1.)*.5)) discard;
  if(shape==4 && (d>1. || d<.94)) discard;
  float edge=shape==0 ? smoothstep(.72,1.,d) : 0.;
  frag=vec4(color.rgb*(1.-edge*.22),color.a);
}`;
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private readonly data = new Float32Array((ENEMY_CAP * 2 + BULLET_CAP + 2500) * 10);
  private count = 0;
  private program: WebGLProgram;
  private buffer: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  lost = false;
  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('This device could not start WebGL 2. Close other apps and reopen the game.');
    this.gl = gl;
    const shader = (type: number, source: string): WebGLShader => {
      const s = gl.createShader(type)!; gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'Shader compilation failed');
      return s;
    };
    this.program = gl.createProgram()!;
    const vert = shader(gl.VERTEX_SHADER, VERTEX), frag = shader(gl.FRAGMENT_SHADER, FRAGMENT);
    gl.attachShader(this.program, vert); gl.attachShader(this.program, frag); gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program) ?? 'Renderer link failed');
    gl.deleteShader(vert); gl.deleteShader(frag);
    this.vao = gl.createVertexArray()!; gl.bindVertexArray(this.vao);
    this.buffer = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    for (const [location, size, offset] of [[0, 2, 0], [1, 2, 2], [2, 1, 4], [3, 4, 5], [4, 1, 9]]) {
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 40, offset * 4); gl.vertexAttribDivisor(location, 1);
    }
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => location.reload());
  }
  resize(): void {
    const pixels = Math.round(this.canvas.clientWidth * Math.min(2, window.devicePixelRatio || 1));
    if (pixels && this.canvas.width !== pixels) { this.canvas.width = pixels; this.canvas.height = pixels; this.gl.viewport(0, 0, pixels, pixels); }
  }
  shape(x: number, y: number, sx: number, sy: number, color: number, kind = 0, angle = 0, alpha = 1): void {
    const i = this.count++ * 10, d = this.data;
    d[i] = x; d[i+1] = y; d[i+2] = sx; d[i+3] = sy; d[i+4] = angle;
    d[i+5] = ((color >> 16) & 255) / 255; d[i+6] = ((color >> 8) & 255) / 255; d[i+7] = (color & 255) / 255;
    d[i+8] = alpha; d[i+9] = kind;
  }
  line(x: number, y: number, x2: number, y2: number, width: number, color: number, alpha = 1): void {
    this.shape((x+x2)/2, (y+y2)/2, Math.hypot(x2-x, y2-y)/2, width, color, 1, Math.atan2(y2-y, x2-x), alpha);
  }
  render(sim: Simulation, selectedSlot = -3): void {
    if (this.lost) return;
    this.count = 0;
    this.shape(0, 0, 22, 22, 0x5d6750, 0, 0, .6);
    this.shape(0, 0, 20, 20, 0x343f36); this.shape(0, 0, 19.3, 19.3, 0x788069, 4, 0, .25);
    this.shape(0, 0, 9, 9, 0x4b5747); this.shape(0, 0, 8.4, 8.4, 0x65705a, 4, 0, .5);
    const layout = sim.phase === 'home' ? sim.progression.save.layout : sim.stats.meta.layout;
    for (let t = 0; t < 8; t++) {
      const x = sim.towerX[t], y = sim.towerY[t], weapon = layout[t];
      this.shape(x, y + .6, 3.2, 3.2, 0x101e1c, 1, Math.PI / 4, .7);
      this.shape(x, y, 2.8, 2.8, selectedSlot === t ? 0xeacb80 : 0x667060, 4);
      if (weapon === -2) { this.shape(x, y, .4, .4, 0xb6b697); continue; }
      if (sim.towerHp[t] <= 0 && sim.phase !== 'home') { this.shape(x, y, 1.6, 1.1, 0x42423c, 2); continue; }
      if (weapon === -1) {
        this.shape(x, y, 3.4, 1.5, 0xb5ab8e, 1, t * Math.PI / 4);
        this.shape(x, y, 2.9, .25, 0x81795f, 1, t * Math.PI / 4);
      } else {
        this.shape(x, y, 2.4, 2.4, 0x8caa9a, 2);
        const angle = sim.phase === 'home' ? t * Math.PI / 4 - Math.PI / 2 : sim.towerAngle[t];
        this.line(x, y, x + Math.cos(angle) * 3.5, y + Math.sin(angle) * 3.5, .75, WEAPONS[weapon].color);
        this.shape(x, y, 1.3, 1.3, 0x273b34);
      }
      if (sim.phase === 'combat' && sim.towerHp[t] < 90) {
        this.shape(x, y + 4, 2.8, .35, 0x15241e, 1);
        const width = 2.8 * sim.towerHp[t] / 90;
        this.shape(x - 2.8 + width, y + 4, width, .35, sim.towerHp[t] > 30 ? 0xaec881 : 0xf08766, 1);
      }
    }
    const e = sim.enemies;
    for (let i = 0; i < e.count; i++) {
      if (e.hp[i] <= 0) continue;
      const kind = e.kind[i], size = e.size[i];
      const color = e.life[i] > 0 ? 0xffe9cd : kind === 3 ? 0xe6b0d4 : kind === 2 ? 0xb681aa : kind === 1 ? 0xd9b786 : 0xcc7865;
      this.shape(e.x[i], e.y[i] + size * .25, size * 1.12, size * .85, 0x182723, 0, 0, .6);
      this.shape(e.x[i], e.y[i], size, size, color, kind === 1 ? 2 : kind === 2 ? 1 : 0);
    }
    const f = sim.effects;
    for (let i = 0; i < f.count; i++) {
      const alpha = f.life[i] / f.aux[i];
      if (f.kind[i] === 2) {
        this.line(f.x[i], f.y[i], f.vx[i], f.vy[i], .65, 0x75caff, alpha);
        this.line(f.x[i], f.y[i], f.vx[i], f.vy[i], .18, 0xf0ffff, alpha);
      } else if (f.kind[i] === 1) {
        const dx = f.vx[i] - f.x[i], dy = f.vy[i] - f.y[i];
        this.shape((f.x[i]+f.vx[i])/2, (f.y[i]+f.vy[i])/2, Math.hypot(dx,dy)/2, f.size[i], 0xffad4d, 3, Math.atan2(dy,dx), alpha * .25);
      } else this.shape(f.x[i], f.y[i], f.size[i]*(1.3-alpha*.3), f.size[i]*(1.3-alpha*.3), f.kind[i] === 3 ? 0xddabff : 0xdfc794, 4, 0, alpha*.6);
    }
    const b = sim.bullets;
    for (let i = 0; i < b.count; i++) this.shape(b.x[i], b.y[i], b.kind[i] === 3 ? 1.3 : 1.4, b.kind[i] === 3 ? 1.3 : .3, WEAPONS[b.kind[i]].color, 1, Math.atan2(b.vy[i],b.vx[i]));
    const angle = sim.aim;
    if (sim.phase === 'combat') {
      this.line(Math.cos(angle)*6, Math.sin(angle)*6, Math.cos(angle)*25, Math.sin(angle)*25, .09, 0xf0d389, .6);
      this.shape(Math.cos(angle)*25, Math.sin(angle)*25, 1.2, 1.2, 0xf0d389, 4, 0, .8);
    }
    this.shape(0, .8, 3.7, 3, 0x15261e, 0);
    this.shape(0, 0, 3, 3, 0xf0ce87, 2);
    this.line(0, 0, Math.cos(angle)*4.2, Math.sin(angle)*4.2, .8, 0xffe7b0);
    this.shape(0, 0, 1.6, 1.6, 0x485843);
    if (selectedSlot === -1) this.shape(0, 0, 5, 5, 0xeacb80, 4);
    const gl = this.gl; gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(this.program); gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer); gl.bufferSubData(gl.ARRAY_BUFFER,0,this.data,0,this.count*10);
    gl.drawArraysInstanced(gl.TRIANGLES,0,6,this.count);
  }
  dispose(): void { this.gl.deleteBuffer(this.buffer); this.gl.deleteVertexArray(this.vao); this.gl.deleteProgram(this.program); }
}
