export const semanticDefaultSurface = "#d9e7f1";
export const semanticDefaultInk = "#16212b";

export const semanticInstanceCss = `
  display: grid;
  place-items: center;
  overflow: hidden;
  transform: scale(var(--scale));
  transform-origin: center;
  opacity: var(--opacity);
  border: 1px solid color-mix(in srgb, var(--surface) 70%, #0f9bb8);
  border-radius: 12px;
  background: var(--surface);
  color: var(--ink);
  text-align: center;
  box-shadow: 0 5px 0 color-mix(in srgb, var(--surface) 84%, #0b1725);
`;

export const semanticAssetCss = `
  position: absolute;
  inset: 8%;
  width: 84%;
  height: 84%;
  object-fit: var(--fit);
  filter: drop-shadow(0 2px 2px #0b172566);
  pointer-events: none;
`;

export const semanticCopyCss = `
  position: relative;
  z-index: 1;
  padding: 6px 9px;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.15;
  text-wrap: balance;
`;

// A semantic group that owns child instances renders its own copy as a top
// title band so the label never lands on top of the children painted over it.
export const semanticTitleCss = `
  position: absolute;
  inset: 0 0 auto 0;
  z-index: 2;
  padding: 11px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--surface) 60%, #0b1725);
  color: var(--ink);
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -.01em;
  text-align: center;
`;

// Toggle instances read as a labelled switch: copy on the leading edge, the
// switch track on the trailing edge.
export const semanticToggleCss = `
  display: flex;
  place-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  text-align: left;
`;

export const semanticSwitchCss = `
  position: relative;
  flex: 0 0 auto;
  width: 46px;
  height: 27px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--ink) 24%, transparent);
  background: color-mix(in srgb, var(--ink) 15%, #ffffff);
`;

export const semanticSwitchKnobCss = `
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 19px;
  height: 19px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 2px #0b172566;
`;

export const semanticSwitchOnCss = "background: #2a9d72; border-color: #1c7f5c;";
export const semanticSwitchKnobOnCss = "left: auto; right: 3px;";
export const semanticSwitchDisabledCss = "background: color-mix(in srgb, var(--ink) 18%, #ffffff); opacity: .55;";

// An art region with no copy and no assigned raster shows a muted placeholder
// label instead of a naked surface, so it reads as an intentional slot.
export const semanticPlaceholderCss = `
  position: relative;
  z-index: 1;
  padding: 6px 10px;
  color: color-mix(in srgb, var(--ink) 46%, transparent);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: .02em;
`;
