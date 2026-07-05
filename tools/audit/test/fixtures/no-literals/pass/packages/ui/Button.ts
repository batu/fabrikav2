// Token-only: color via --fab-* custom property, copy injected from a data
// contract, no asset path literals. This is the shape guardrail #2 wants.
export function mountButton(host: HTMLElement, copy: { label: string }): void {
  host.style.setProperty('color', 'var(--fab-button-fg)');
  host.textContent = copy.label;
}
