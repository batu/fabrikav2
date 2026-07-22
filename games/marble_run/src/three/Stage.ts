/**
 * Three.js stage: renderer, dimetric orthographic camera, lights,
 * background. One Stage lives for the whole app; board scenes are
 * swapped in and out of `world`.
 */
import * as THREE from 'three';
import { GAMEPLAY_CAMERA_GROUND_ANGLE_DEG, MAX_RENDER_DPR, type CameraMode } from './constants';

const CAMERA_MODE_OFFSETS: Record<CameraMode, { readonly yawDeg: number; readonly groundAngleDeg: number }> = {
  perspective: { yawDeg: 0, groundAngleDeg: 0 },
  dimetric: { yawDeg: 0, groundAngleDeg: 0 },
  isometric: { yawDeg: 0, groundAngleDeg: -25 },
  trimetric: { yawDeg: -13, groundAngleDeg: -8 },
};

const BOARD_SCREEN_WIDTH_FILL = 0.9;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  readonly world = new THREE.Group();
  private frustumSize = 12;
  private perspectiveDistance = 16;
  private viewOffsetYRatio = 0.035;
  private cameraMode: CameraMode = 'dimetric';
  private cameraGroundAngleDeg = GAMEPLAY_CAMERA_GROUND_ANGLE_DEG;
  private cameraYawDeg = 45;
  private framedBoard: { readonly w: number; readonly d: number } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_RENDER_DPR));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Dimetric camera: azimuth defaults to 45deg, elevation controlled by
    // GAMEPLAY_CAMERA_GROUND_ANGLE_DEG so product can tune it live.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.setDebugCamera('dimetric', GAMEPLAY_CAMERA_GROUND_ANGLE_DEG, 45);

    this.scene.add(this.world);

    // Warm daylight rig.
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(6, 14, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -10;
    sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 10;
    sun.shadow.camera.bottom = -10;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);

    const sky = new THREE.HemisphereLight(0xfff8f2, 0xe8a8c4, 1.2);
    this.scene.add(sky);

    // Warm gradient background via large vertical plane behind everything
    // is overkill — a fog-tinted clear color reads as the wooden room.
    this.renderer.setClearColor(0x000000, 0); // CSS gradient shows through

    // Ground plane catching soft shadows under the floating tray.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.ShadowMaterial({ opacity: 0.13 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.86;
    ground.receiveShadow = true;
    this.scene.add(ground);


    this.resize();
    this.onWindowResize = () => this.resize();
    window.addEventListener('resize', this.onWindowResize);
  }

  /**
   * fabrikav2 addition (not in v1): v1 kept one Stage for the whole app life,
   * so it never removed its resize listener or disposed the GL context. In v2
   * the Phaser GameScene mounts/unmounts a Stage per level run, so a dispose
   * seam is required to avoid a resize-listener + WebGL-context leak.
   */
  private readonly onWindowResize: () => void;

  dispose(): void {
    window.removeEventListener('resize', this.onWindowResize);
    this.renderer.dispose();
  }

  setDimetricCamera(groundAngleDeg: number, yawDeg = 45): void {
    this.setDebugCamera('dimetric', groundAngleDeg, yawDeg);
  }

  setDebugCamera(mode: CameraMode, groundAngleDeg: number, yawDeg = 45): void {
    this.cameraMode = mode;
    this.cameraGroundAngleDeg = groundAngleDeg;
    this.cameraYawDeg = yawDeg;
    const shouldUsePerspective = mode === 'perspective';
    if (shouldUsePerspective && !(this.camera instanceof THREE.PerspectiveCamera)) {
      this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    } else if (!shouldUsePerspective && !(this.camera instanceof THREE.OrthographicCamera)) {
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    }
    this.recomputeFrustumSize();
    this.placeCamera();
    this.resize();
  }

  private placeCamera(): void {
    const distance = this.camera instanceof THREE.PerspectiveCamera ? this.perspectiveDistance : 16;
    const modeOffset = CAMERA_MODE_OFFSETS[this.cameraMode];
    const effectiveGroundAngleDeg = THREE.MathUtils.clamp(
      this.cameraGroundAngleDeg + modeOffset.groundAngleDeg,
      15,
      85,
    );
    const effectiveYawDeg = this.cameraYawDeg + modeOffset.yawDeg;
    const angle = THREE.MathUtils.degToRad(effectiveGroundAngleDeg);
    const yaw = THREE.MathUtils.degToRad(effectiveYawDeg);
    const horizontal = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    const x = Math.cos(yaw) * horizontal;
    const z = Math.sin(yaw) * horizontal;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 0, 0);
  }

  /** Fit a board of world size w×d into view with margins for UI. */
  frameBoard(w: number, d: number): void {
    this.framedBoard = { w, d };
    this.recomputeFrustumSize();
    this.resize();
  }

  private recomputeFrustumSize(): void {
    if (!this.framedBoard) return;
    const { w, d } = this.framedBoard;
    const projected = this.projectedHorizontalBoardSpan(w, d);
    const perspectivePadding = this.cameraMode === 'perspective' ? 1.08 : 1;
    this.frustumSize = (projected / BOARD_SCREEN_WIDTH_FILL) * perspectivePadding;
  }

  private projectedHorizontalBoardSpan(w: number, d: number): number {
    const modeOffset = CAMERA_MODE_OFFSETS[this.cameraMode];
    const yaw = THREE.MathUtils.degToRad(this.cameraYawDeg + modeOffset.yawDeg);
    return Math.abs(w * Math.sin(yaw)) + Math.abs(d * Math.cos(yaw));
  }

  setViewOffsetYRatio(ratio: number): void {
    this.viewOffsetYRatio = ratio;
    this.resize();
  }

  resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const f = this.frustumSize;
    this.placeCamera();
    if (this.camera instanceof THREE.OrthographicCamera) {
      if (aspect >= 1) {
        this.camera.left = (-f / 2) * aspect;
        this.camera.right = (f / 2) * aspect;
        this.camera.top = f / 2;
        this.camera.bottom = -f / 2;
      } else {
        // Portrait: fit by width so the board spans the screen nicely.
        this.camera.left = -f / 2;
        this.camera.right = f / 2;
        this.camera.top = f / 2 / aspect;
        this.camera.bottom = -f / 2 / aspect;
      }
      this.camera.updateProjectionMatrix();
      // Pan the view a touch so the board sits slightly above screen center
      // (clears the bottom banner/counter zone).
      this.camera.setViewOffset(width, height, 0, height * this.viewOffsetYRatio, width, height);
      return;
    }
    this.camera.aspect = aspect;
    this.camera.fov = this.cameraMode === 'perspective' ? 30 : 32;
    const visibleHeight = aspect >= 1 ? f : f / aspect;
    const fitFov = THREE.MathUtils.degToRad(this.camera.fov);
    this.perspectiveDistance = (visibleHeight / 2) / Math.tan(fitFov / 2);
    this.placeCamera();
    this.camera.updateProjectionMatrix();
    this.camera.setViewOffset(width, height, 0, height * this.viewOffsetYRatio, width, height);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Raycast pointer against meshes; returns the first hit object or null. */
  pickObject(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Object3D | null {
    const el = this.renderer.domElement;
    const rect = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(objects, false);
    return hits.length > 0 ? hits[0].object : null;
  }

  /** Raycast a client-space pointer onto the y=plane of marble centers. */
  pointerToWorld(clientX: number, clientY: number, planeY: number): THREE.Vector3 | null {
    const el = this.renderer.domElement;
    const rect = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    const out = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, out) ? out : null;
  }

  worldToClient(point: THREE.Vector3): { x: number; y: number } {
    const el = this.renderer.domElement;
    const rect = el.getBoundingClientRect();
    const projected = point.clone().project(this.camera);
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height,
    };
  }
}
