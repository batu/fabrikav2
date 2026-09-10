import Phaser from 'phaser';
interface Point { x: number; y: number }

const PIPELINE_KEY = 'ClassicGpuReveal';

interface RevealUniforms {
  center: Point;
  width: number;
  height: number;
  radius: number;
  feather: number;
}

interface RevealCell {
  image: Phaser.GameObjects.Image;
  graphics: Phaser.GameObjects.Graphics;
  mask: Phaser.Display.Masks.GeometryMask;
  points: Point[];
}

/** Sample the existing artwork; only the expanding radius changes per frame. */
class RevealPipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
  constructor(game: Phaser.Game) {
    super({ game, fragShader: `
      #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
      #else
      precision mediump float;
      #endif
      uniform sampler2D uMainSampler;
      uniform vec2 uCenter;
      uniform vec2 uExtent;
      uniform float uRadius;
      uniform float uFeather;
      varying vec2 outTexCoord;
      varying vec4 outTint;
      void main() {
        float distanceToCenter = length((outTexCoord - uCenter) * uExtent);
        float alpha = uRadius <= 0.0 ? 0.0
          : 1.0 - smoothstep(uRadius, uRadius + uFeather, distanceToCenter);
        gl_FragColor = texture2D(uMainSampler, outTexCoord)
          * vec4(outTint.bgr * outTint.a, outTint.a) * alpha;
      }
    ` });
  }

  override onBind(gameObject?: Phaser.GameObjects.GameObject): void {
    if (!gameObject) return;
    const data = (gameObject as Phaser.GameObjects.Image).pipelineData as RevealUniforms;
    // Uniform changes must never affect a previously queued image.
    this.flush();
    this.set2f('uCenter', data.center.x, data.center.y);
    this.set2f('uExtent', data.width, data.height);
    this.set1f('uRadius', data.radius);
    this.set1f('uFeather', data.feather);
  }
}

/** Static stencil polygons avoid iOS BitmapMask and per-frame canvas uploads. */
export class ClassicGpuReveal {
  private active: RevealCell | null = null;
  private cells: RevealCell[] = [];
  private readonly completed: RevealCell;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly extent: { x: number; y: number; width: number; height: number },
    private readonly feather: number,
  ) {
    this.completed = this.createCell([]);
    const renderer = scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    if (!renderer.pipelines.has(PIPELINE_KEY)) {
      renderer.pipelines.add(PIPELINE_KEY, new RevealPipeline(scene.game));
      // WebKit can defer driver compilation until the first draw. Exercise the
      // stencil + shader during level setup, with radius zero (fully transparent).
      const { x, y } = extent;
      this.start([{ x, y }, { x: x + 1, y }, { x: x + 1, y: y + 1 }, { x, y: y + 1 }], { x, y });
      const warmup = this.active!;
      this.active = null;
      scene.game.events.once('postrender', () => {
        this.destroyCell(warmup);
      });
    }
  }

  start(points: Point[], center: Point): void {
    if (points.length < 3) return;
    const { x, y, width, height } = this.extent;
    const cell = this.createCell(points);
    cell.image.setPipeline(PIPELINE_KEY, {
      center: { x: (center.x - x) / width, y: (center.y - y) / height },
      width, height, radius: 0, feather: this.feather,
    } satisfies RevealUniforms);
    this.active = cell;
  }

  private createCell(points: Point[]): RevealCell {
    const { x, y, width, height } = this.extent;
    const graphics = this.scene.make.graphics({}, false);
    graphics.fillStyle(0xffffff);
    if (points.length >= 3) graphics.fillPoints(points, true);
    const mask = graphics.createGeometryMask();
    const image = this.scene.add.image(x, y, 'color').setOrigin(0, 0)
      .setDisplaySize(width, height).setMask(mask);
    if (points.length >= 3) {
      const source = this.scene.textures.get('color').getSourceImage() as HTMLImageElement;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of points) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
      const left = Math.max(0, Math.floor((minX - x) / width * source.width));
      const top = Math.max(0, Math.floor((minY - y) / height * source.height));
      const right = Math.min(source.width, Math.ceil((maxX - x) / width * source.width));
      const bottom = Math.min(source.height, Math.ceil((maxY - y) / height * source.height));
      image.setCrop(left, top, right - left, bottom - top);
    }
    const cell = { image, graphics, mask, points };
    this.cells.push(cell);
    return cell;
  }

  update(radius: number | null): void {
    if (!this.active) return;
    if (radius === null) {
      // All completed polygons share one stencil/image, so draw calls do not
      // grow with the number of finds. Keep the original full-quality texture.
      this.completed.graphics.fillPoints(this.active.points, true);
      this.destroyCell(this.active);
      this.active = null;
    } else {
      (this.active.image.pipelineData as RevealUniforms).radius = radius;
    }
  }

  destroy(): void {
    while (this.cells.length) this.destroyCell(this.cells[0]);
    this.active = null;
  }

  private destroyCell(cell: RevealCell): void {
    const index = this.cells.indexOf(cell);
    if (index < 0) return;
    cell.image.clearMask();
    cell.image.destroy();
    cell.mask.destroy();
    cell.graphics.destroy();
    this.cells.splice(index, 1);
  }
}
