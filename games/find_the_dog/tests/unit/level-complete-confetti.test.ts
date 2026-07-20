import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountLevelComplete } from "../../src/v1core/ui";
import {
  hideSceneTransitionCover,
  isPlayEntryTransitionActive,
  showPlayEntryTransitionCover,
  showSceneTransitionCover,
} from "../../src/ui/SceneTransitionCover";

vi.mock("phaser", () => ({
  default: { Scenes: { Events: { RENDER: "render" } } },
}));

const CONFETTI_CLEANUP_FULL_MS = 3040 * 1.2 + 1920 + 260;
const CONFETTI_CLEANUP_REDUCED_MS = 900 * 1.2 + 260;

function setReducedMotion(matches: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches })),
  });
}

function mountCompletion() {
  const mountInto = document.createElement("div");
  document.body.appendChild(mountInto);
  return mountLevelComplete({
    mountInto,
    content: {
      messages: ["Level Clear!"],
      rewardLabel: "Coins earned",
      rewardAmount: 10,
      balanceBefore: 90,
      claimLabel: "CLAIM",
      nextLabel: "Next Level",
      nextLoadingLabel: "Loading…",
    },
    actions: {
      onClaim: vi.fn(async () => undefined),
      onNext: vi.fn(async () => undefined),
    },
  });
}

describe("level-complete confetti", () => {
  let originalAnimate: PropertyDescriptor | undefined;
  let animate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: vi.fn(() => []),
    });
    originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
    animate = vi.fn(() => ({ cancel: vi.fn() } as unknown as Animation));
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      writable: true,
      value: animate,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = "";
    if (originalAnimate) {
      Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "animate");
    }
  });

  it("emits the cumulative full-motion shell-template piece contract and self-cleans", () => {
    setReducedMotion(false);
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const handle = mountCompletion();
    const pieces = Array.from(handle.el.querySelectorAll<HTMLElement>(".fab-confetti-piece"));

    expect(pieces).toHaveLength(1080);
    expect(animate).toHaveBeenCalledTimes(1080);
    expect(pieces[0]?.style.width).toBe("10px");
    expect(pieces[0]?.style.height).toBe("13px");
    expect(handle.el.querySelector(".fab-complete-confetti-fall")).toBeNull();
    expect(handle.el.querySelector(".fab-complete-confetti-burst")).toBeNull();

    const [leftFrames, leftTiming] = animate.mock.calls[0] as [Keyframe[], KeyframeAnimationOptions];
    const [rightFrames] = animate.mock.calls[1] as [Keyframe[], KeyframeAnimationOptions];
    const [rainFrames] = animate.mock.calls[4] as [Keyframe[], KeyframeAnimationOptions];
    expect(leftFrames).toHaveLength(23);
    expect(leftTiming).toMatchObject({ duration: 3040, delay: 960, easing: "linear", fill: "both" });
    expect(animate.mock.calls.every(([, options]) => {
      const timing = options as KeyframeAnimationOptions;
      return Number(timing.duration) >= 2432
        && Number(timing.duration) <= 3648
        && Number(timing.delay) >= 0
        && Number(timing.delay) <= 1920;
    })).toBe(true);
    expect(leftFrames.every((frame) => !("easing" in frame))).toBe(true);
    expect(String(leftFrames[0]?.transform)).toContain("translate3d(-30.0px, 800.0px, 0)");
    expect(String(rightFrames[0]?.transform)).toContain("translate3d(1030.0px, 800.0px, 0)");
    expect(String(rainFrames[0]?.transform)).toContain("translate3d(500.0px, -80.0px, 0)");
    expect(leftFrames.at(-1)?.opacity).toBeCloseTo(0);
    expect(leftFrames.every((frame) => !/NaN|Infinity/.test(String(frame.transform)))).toBe(true);

    vi.advanceTimersByTime(CONFETTI_CLEANUP_FULL_MS);
    expect(handle.el.querySelector(".fab-complete-side-confetti")).toBeNull();
  });

  it("uses the bounded reduced-motion treatment and removes it on schedule", () => {
    setReducedMotion(true);
    vi.spyOn(Math, "random").mockReturnValue(1);

    const handle = mountCompletion();
    const pieces = handle.el.querySelectorAll<HTMLElement>(".fab-confetti-piece");
    const [, timing] = animate.mock.calls[0] as [Keyframe[], KeyframeAnimationOptions];

    expect(pieces).toHaveLength(20);
    expect(pieces[0]?.style.width).toBe("14px");
    expect(pieces[0]?.style.height).toBe("18px");
    expect(timing).toMatchObject({ duration: 1080, delay: 0, easing: "linear", fill: "both" });

    vi.advanceTimersByTime(CONFETTI_CLEANUP_REDUCED_MS);
    expect(handle.el.querySelector(".fab-complete-side-confetti")).toBeNull();
  });

  it("keeps a safe static fallback and teardown cancels stale scheduled work", async () => {
    setReducedMotion(true);
    vi.spyOn(Math, "random").mockReturnValue(0);
    Reflect.deleteProperty(HTMLElement.prototype, "animate");

    const handle = mountCompletion();
    expect(handle.el.querySelectorAll(".fab-confetti-piece")).toHaveLength(20);
    expect(handle.el.querySelector<HTMLElement>(".fab-confetti-piece")?.style.width).toBe("6px");
    expect(handle.el.querySelector<HTMLElement>(".fab-confetti-piece")?.style.height).toBe("8px");

    handle.dismiss();
    await handle.dismissed;
    expect(handle.el.isConnected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(CONFETTI_CLEANUP_REDUCED_MS * 2);
    expect(document.querySelector(".fab-complete-side-confetti")).toBeNull();
  });

  it("has no second Phaser or bitmap confetti runtime owner", () => {
    const gameScene = readFileSync(join(process.cwd(), "src/scenes/GameScene.ts"), "utf8");
    const wrapper = readFileSync(join(process.cwd(), "src/ui/LevelCompleteOverlay.ts"), "utf8");
    const coreCss = readFileSync(join(process.cwd(), "src/v1core/ui/ui.css"), "utf8");

    expect(gameScene).not.toMatch(/confetti_square|emitConfettiBurst|emitArrowStyleConfettiPieces/);
    expect(wrapper).not.toMatch(/COMPLETION_CONFETTI|fab-complete-confetti-(?:burst|fall)-url/);
    expect(coreCss).toContain(".fab-confetti-piece");
    expect(coreCss).not.toMatch(/fabCompleteConfetti(?:Side|Top)Blast|fab-complete-confetti-(?:burst|fall)/);
  });

  it("clones the live home into the generation-guarded play-entry cover", () => {
    setReducedMotion(true);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    document.body.innerHTML = `
      <div id="game-container"></div>
      <div id="hud-overlay">
        <div id="home-shell"><button id="home-play-now">Play</button></div>
      </div>
    `;

    showPlayEntryTransitionCover();

    const cover = document.getElementById("scene-transition-cover");
    expect(isPlayEntryTransitionActive()).toBe(true);
    expect(cover?.dataset.transitionState).toBe("holding");
    expect(cover?.querySelector(".play-entry-home-shell #home-play-now")).not.toBeNull();
    expect(cover?.querySelector(".play-entry-home-shell")?.hasAttribute("inert")).toBe(true);
    expect(document.getElementById("hud-overlay")?.classList.contains("play-entry-hud-enter-pending")).toBe(true);

    hideSceneTransitionCover();
    vi.advanceTimersByTime(3);
    expect(cover?.classList.contains("hiding")).toBe(true);
    vi.advanceTimersByTime(240);
    expect(cover?.isConnected).toBe(false);

    vi.advanceTimersByTime(680);
    expect(document.getElementById("hud-overlay")?.classList.contains("play-entry-hud-enter-pending")).toBe(false);
  });

  it("does not let an older play-entry hide remove a newer generic cover", () => {
    setReducedMotion(true);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    document.body.innerHTML = `
      <div id="game-container"></div>
      <div id="hud-overlay"><div id="home-shell"></div></div>
    `;

    showPlayEntryTransitionCover();
    hideSceneTransitionCover();
    showSceneTransitionCover();
    vi.runAllTimers();

    const cover = document.getElementById("scene-transition-cover");
    expect(cover?.dataset.transitionKind).toBe("generic");
    expect(cover?.querySelector(".scene-transition-cover-avatar")).not.toBeNull();
  });
});
