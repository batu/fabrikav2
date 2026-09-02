import type { MageMasterHarness } from "../shell/harness.ts";

/**
 * Dev-only remote drive for on-device iteration. The dev server serves
 * `/__drive.json` (written by the agent on the Mac); the phone polls it and
 * applies one command per change, then POSTs canvas frames back to
 * `/__frames` when asked. A tool, not a loop: the agent owns the loop.
 *
 * Command shape: { "seq": n, "op": "driveTo"|"verb"|"frames"|"snapshot", "args": [...] }
 */
interface DriveCommand {
  readonly seq: number;
  readonly op: "driveTo" | "verb" | "frames" | "snapshot" | "reload" | "inspect" | "eval";
  readonly args?: readonly unknown[];
}

const recentErrors: string[] = [];

export function installDevDrive(harness: MageMasterHarness): void {
  let lastSeq = -1;
  window.addEventListener("error", (event) => recentErrors.push(`${event.message} @${event.filename}:${event.lineno}`));
  window.addEventListener("unhandledrejection", (event) => recentErrors.push(`unhandled: ${String((event as PromiseRejectionEvent).reason)}`));
  const post = async (path: string, body: unknown): Promise<void> => {
    try {
      await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      // The drive channel is best-effort.
    }
  };
  const apply = async (cmd: DriveCommand): Promise<void> => {
    const args = cmd.args ?? [];
    switch (cmd.op) {
      case "driveTo": {
        const ok = await harness.driveTo?.(String(args[0]));
        await post("/__drive/result", { seq: cmd.seq, ok, snapshot: harness.snapshot() });
        break;
      }
      case "verb": {
        const name = String(args[0]) as keyof typeof harness.verbs;
        const handler = harness.verbs[name];
        const result = handler ? handler.run(...(args.slice(1) as [])) : null;
        await post("/__drive/result", { seq: cmd.seq, ok: result, snapshot: harness.snapshot() });
        break;
      }
      case "frames": {
        const frames = await harness.captureFrames(Number(args[0] ?? 8), Number(args[1] ?? 80));
        await post("/__drive/frames", { seq: cmd.seq, frames });
        break;
      }
      case "snapshot":
        await post("/__drive/result", { seq: cmd.seq, ok: true, snapshot: harness.snapshot() });
        break;
      case "inspect": {
        // Computed style + rect of matching elements: the CDP substitute on iOS.
        const selector = String(args[0]);
        const props = (args[1] as string[] | undefined) ?? ["background-image", "background-color", "color", "font-family", "display", "opacity"];
        const found = Array.from(document.querySelectorAll<HTMLElement>(selector)).slice(0, 6).map((node) => {
          const cs = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          const style: Record<string, string> = {};
          for (const prop of props) style[prop] = cs.getPropertyValue(prop);
          return { tag: node.tagName, className: node.className, inline: node.getAttribute("style"), rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, style };
        });
        await post("/__drive/result", { seq: cmd.seq, ok: found.length > 0, found, errors: recentErrors.slice(-5) });
        break;
      }
      case "eval": {
        // Dev-only escape hatch for on-device debugging; never shipped (installed only under import.meta.env.DEV).
        let value: unknown;
        try {
          value = await new Function(String(args[0]))();
        } catch (error) {
          value = `error: ${String(error)}`;
        }
        await post("/__drive/result", { seq: cmd.seq, ok: true, value, errors: recentErrors.slice(-5) });
        break;
      }
      case "reload":
        location.reload();
        break;
    }
  };
  const poll = async (): Promise<void> => {
    try {
      const res = await fetch(`/__drive.json?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const cmd = (await res.json()) as DriveCommand;
        if (typeof cmd.seq === "number" && cmd.seq > lastSeq) {
          lastSeq = cmd.seq;
          await apply(cmd);
        }
      }
    } catch {
      // Dev server unreachable; keep polling.
    }
    window.setTimeout(() => void poll(), 700);
  };
  void poll();
}
