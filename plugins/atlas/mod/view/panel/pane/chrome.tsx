// chrome.tsx — text helpers shared by the sidebar.

/** under 45 s reads "now", then 42s / 4m12s / 1h02m */
export function ageStr(ms: number): string {
  if (ms < 45_000) return 'now';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m < 1) return `${s}s`;
  if (m < 60) return `${m}m${s % 60}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

/** Raw agent ids (17 hex) never reach the screen: cut to 6 chars as a last resort. */
export const scrub = (text: string): string => text.replace(/\b[0-9a-f]{17}\b/g, (m) => m.slice(0, 6));
