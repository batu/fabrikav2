import { useEffect, useMemo, useState } from 'react';

/** Device presets mirrored from the portal's Device Lab
 *  (portal/gallery/templates/game.html) — width/height are CSS px, safe areas
 *  are the per-device notch/home insets. Keep in sync by hand; the portal is
 *  the source of truth for this table. */
export const DEVICE_PRESETS = [
  { id: 'iphone-se', name: 'iPhone SE', width: 375, height: 667, safeTop: 20, safeBottom: 0 },
  { id: 'iphone-13-mini', name: 'iPhone 13 mini', width: 375, height: 812, safeTop: 47, safeBottom: 34 },
  { id: 'iphone-13-pro', name: 'iPhone 13 Pro', width: 390, height: 844, safeTop: 47, safeBottom: 34 },
  { id: 'iphone-14-pro', name: 'iPhone 14 Pro', width: 393, height: 852, safeTop: 59, safeBottom: 34 },
  { id: 'iphone-15-pro', name: 'iPhone 15 Pro', width: 393, height: 852, safeTop: 59, safeBottom: 34 },
  { id: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max', width: 440, height: 956, safeTop: 62, safeBottom: 34 },
  { id: 'pixel-7', name: 'Pixel 7', width: 412, height: 915, safeTop: 24, safeBottom: 24 },
  { id: 'pixel-8-pro', name: 'Pixel 8 Pro', width: 448, height: 998, safeTop: 24, safeBottom: 24 },
  { id: 'galaxy-s23', name: 'Galaxy S23', width: 360, height: 780, safeTop: 24, safeBottom: 24 },
  { id: 'galaxy-s24-ultra', name: 'Galaxy S24 Ultra', width: 412, height: 915, safeTop: 24, safeBottom: 24 },
] as const;

/** Mirrors GameScene's board fit (cover): scale = max, centered. Exported for
 *  the parity test against the runtime math. */
export function coverPlacement(deviceW: number, deviceH: number, levelW: number, levelH: number) {
  const scale = Math.max(deviceW / levelW, deviceH / levelH);
  return {
    scale,
    offsetX: (deviceW - levelW * scale) / 2,
    offsetY: (deviceH - levelH * scale) / 2,
  };
}

interface SessionLike {
  id: string;
  hitboxes?: { x: number; y: number; r: number }[];
}

interface GeometryConfig {
  hudFraction: number;
  bannerFraction: number;
}

/** Render a session's current art inside a real device frame with the game's
 *  chrome (safe areas, HUD, ad banner) drawn on top — toggleable — so layout
 *  risk is visible before anything ships. Batu: "I am not trusting the safe
 *  areas." This view exists so trust is unnecessary. */
export function DevicePreview({ session, imageUrl, levelWidth, levelHeight }: {
  session: SessionLike;
  imageUrl: string;
  levelWidth: number;
  levelHeight: number;
}) {
  const [deviceId, setDeviceId] = useState<string>('pixel-8-pro');
  const [showChrome, setShowChrome] = useState(true);
  const [showHitboxes, setShowHitboxes] = useState(false);
  const [geometry, setGeometry] = useState<GeometryConfig | null>(null);
  const [chromeMissing, setChromeMissing] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch('/api/config/geometry')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (active && data) setGeometry(data); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const device = DEVICE_PRESETS.find((preset) => preset.id === deviceId) ?? DEVICE_PRESETS[0];
  const display = 0.55; // shrink the CSS-px device to fit the panel
  const placement = useMemo(
    () => coverPlacement(device.width, device.height, levelWidth, levelHeight),
    [device, levelWidth, levelHeight],
  );

  const hudPx = (geometry?.hudFraction ?? 0.139) * device.height;
  const bannerPx = (geometry?.bannerFraction ?? 0.071) * device.height;

  const overlayBand = (key: string, top: number, height: number, color: string, label: string) => (
    <div key={key} style={{
      position: 'absolute', left: 0, right: 0, top: top * display, height: height * display,
      background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 10, color: '#fff', textShadow: '0 1px 2px #000', pointerEvents: 'none',
    }}>{label}</div>
  );

  return (
    <div className="device-preview" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ minWidth: 190 }}>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Device
          <select className="inline-select" value={deviceId} onChange={(e) => { setDeviceId(e.target.value); setChromeMissing(false); }} style={{ display: 'block', marginTop: 4 }}>
            {DEVICE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.name} · {preset.width}×{preset.height}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'block', marginBottom: 4 }}>
          <input type="checkbox" checked={showChrome} onChange={(e) => setShowChrome(e.target.checked)} /> Show game UI
        </label>
        <label style={{ display: 'block' }}>
          <input type="checkbox" checked={showHitboxes} onChange={(e) => setShowHitboxes(e.target.checked)} /> Show hitboxes
        </label>
        <p style={{ color: '#888', fontSize: '0.72rem', marginTop: 8, maxWidth: 190 }}>
          Board is cover-scaled exactly like the game runtime; anything outside the frame is what
          that phone actually crops.
        </p>
      </div>
      <div
        data-device-frame={device.id}
        style={{
          position: 'relative',
          width: device.width * display,
          height: device.height * display,
          overflow: 'hidden',
          borderRadius: 18,
          border: '3px solid #444',
          background: '#000',
          flexShrink: 0,
        }}
      >
        <img
          src={imageUrl}
          alt={`${session.id} on ${device.name}`}
          style={{
            position: 'absolute',
            left: placement.offsetX * display,
            top: placement.offsetY * display,
            width: levelWidth * placement.scale * display,
            height: levelHeight * placement.scale * display,
            maxWidth: 'none',
          }}
        />
        {showHitboxes && (session.hitboxes ?? []).map((hitbox, index) => (
          <div
            key={index}
            style={{
              position: 'absolute',
              left: (placement.offsetX + (hitbox.x - hitbox.r) * placement.scale) * display,
              top: (placement.offsetY + (hitbox.y - hitbox.r) * placement.scale) * display,
              width: hitbox.r * 2 * placement.scale * display,
              height: hitbox.r * 2 * placement.scale * display,
              border: '2px solid rgba(255,0,255,0.85)',
              borderRadius: '50%',
              pointerEvents: 'none',
            }}
          />
        ))}
        {showChrome && !chromeMissing && (
          /* Real game chrome captured from the running game per device (with
             simulated safe-area insets) — the actual HUD/hint UI, not bands. */
          <img
            src={`/device-chrome/${device.id}.png`}
            alt={`${device.name} game UI`}
            onError={() => setChromeMissing(true)}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: device.width * display,
              height: device.height * display,
              maxWidth: 'none',
              pointerEvents: 'none',
            }}
          />
        )}
        {showChrome && chromeMissing && (
          /* Fallback bands when a capture is missing for this device. */
          <>
            {overlayBand('safe-top', 0, device.safeTop, 'rgba(220,40,40,0.35)', `safe area ${device.safeTop}px`)}
            {overlayBand('hud', device.safeTop, hudPx, 'rgba(40,90,220,0.35)', 'HUD')}
            {overlayBand('banner', device.height - device.safeBottom - bannerPx, bannerPx, 'rgba(220,150,40,0.35)', 'ad banner')}
            {device.safeBottom > 0 && overlayBand('safe-bottom', device.height - device.safeBottom, device.safeBottom, 'rgba(220,40,40,0.35)', `safe area ${device.safeBottom}px`)}
          </>
        )}
      </div>
    </div>
  );
}
