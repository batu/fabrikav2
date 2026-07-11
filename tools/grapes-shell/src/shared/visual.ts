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
