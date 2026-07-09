const svgUrl = (source: string): string => `data:image/svg+xml,${encodeURIComponent(source)}`;

const button = (top: string, bottom: string): string => svgUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 435 200">
  <path d="M39 22h357c18 0 32 14 32 32v86c0 22-18 40-40 40H47c-22 0-40-18-40-40V54c0-18 14-32 32-32z" fill="${bottom}"/>
  <path d="M43 12h349c18 0 32 14 32 32v83c0 22-18 40-40 40H51c-22 0-40-18-40-40V44c0-18 14-32 32-32z" fill="${top}"/>
  <path d="M62 28h291c14 0 25 11 25 25" fill="none" stroke="#fff8df" stroke-width="9" stroke-linecap="round" opacity=".46"/>
</svg>`);

const ribbon = (fill: string, trim: string): string => svgUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 898 308">
  <path d="M69 53h760l51 71-51 71H69l-51-71 51-71z" fill="${trim}"/>
  <path d="M94 30h710l55 83-55 83H94l-55-83 55-83z" fill="${fill}"/>
  <path d="M116 57h662" stroke="#fff8df" stroke-width="14" stroke-linecap="round" opacity=".42"/>
</svg>`);

const popup = svgUrl(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 520">
  <path d="M51 33h358c25 0 45 20 45 45v340c0 39-32 71-71 71H77c-39 0-71-32-71-71V78c0-25 20-45 45-45z" fill="#1f2430"/>
  <path d="M53 19h354c25 0 45 20 45 45v334c0 39-32 71-71 71H79c-39 0-71-32-71-71V64c0-25 20-45 45-45z" fill="#fff7df"/>
  <path d="M74 47h283" stroke="#ffffff" stroke-width="13" stroke-linecap="round" opacity=".54"/>
</svg>`);

export const assetUrls = {
  buttonPrimary: button("#d8342f", "#8f1f2b"),
  buttonSecondary: button("#1f2430", "#77d6d1"),
  popup,
  ribbonNeutral: ribbon("#77d6d1", "#1f2430"),
  ribbonWin: ribbon("#d8342f", "#1f2430"),
  ribbonFail: ribbon("#14213a", "#1f2430"),
} as const;
