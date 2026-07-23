/** Show only the key tail so a device screenshot never leaks the full secret. */
export function redactAppLovinSdkKey(value: string): string {
  if (value.length <= 6) return '<redacted>';
  return `<redacted:${value.slice(-4)}>`;
}
