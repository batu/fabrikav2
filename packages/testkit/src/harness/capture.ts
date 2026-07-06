/**
 * capture() — self-screenshot to PNG, returned via the harness (closes insitu
 * ledger gap 1's BROWSER option).
 *
 * SCOPE HONESTY (CONDUCTOR decision 4): this ships the browser canvas path
 * (real, works in a browser) and a TYPED DEVICE STUB that is explicitly UNWIRED.
 * The card describes device debug builds writing the PNG to the app documents
 * dir (pullable via adb/devicectl) — that pull path does not exist anywhere in
 * the tree, so it is NOT claimed to work here. {@link captureToDeviceDocuments}
 * throws with the ledger-gap reference rather than pretending.
 */
import type { CaptureResult } from './contract.ts';

/** Strip the `data:image/png;base64,` prefix a canvas data-URL carries. */
function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

/**
 * Browser path: encode a `<canvas>` to a PNG {@link CaptureResult}. This is the
 * canvas layer of the "composite canvas+DOM" capture; the DOM-overlay
 * composite is a documented LIMITATION here — DOM widgets rendered outside the
 * canvas are not merged in this v1 (a full DOM rasterizer is out of scope, see
 * the card's out-of-scope list). Games whose visible state lives on the canvas
 * (marble_run's board) capture faithfully; DOM chrome is captured separately by
 * the runner (playwright screenshot).
 */
export function captureCanvasPng(canvas: HTMLCanvasElement): CaptureResult {
  const dataUrl = canvas.toDataURL('image/png');
  return {
    pngBase64: stripDataUrlPrefix(dataUrl),
    width: canvas.width,
    height: canvas.height,
  };
}

/**
 * Where a device debug build WOULD write a capture PNG so it is pullable via
 * `adb pull` / `devicectl`. Documented contract for the downstream card that
 * wires it.
 */
export interface DeviceCaptureRequest {
  /** File name to write under the app documents dir (e.g. `menu.png`). */
  readonly fileName: string;
  /** The PNG to persist. */
  readonly capture: CaptureResult;
}

/**
 * DEVICE PATH — UNWIRED STUB (insitu ledger gap 1). There is no wired bridge to
 * the native documents dir in this tree; a device capture cannot be persisted
 * or pulled yet. This exists so the contract is complete and a caller gets a
 * loud, honest failure instead of a silent no-op. The downstream card replaces
 * the throw with a real native-bridge write.
 *
 * @throws Always — the device pull path is a known open gap.
 */
export function captureToDeviceDocuments(_request: DeviceCaptureRequest): never {
  throw new Error(
    'captureToDeviceDocuments is an unwired stub (insitu ledger gap 1): ' +
      'no native documents-dir bridge exists yet. Use captureCanvasPng on the ' +
      'browser path, or wire the native bridge in the downstream device-capture card.',
  );
}
