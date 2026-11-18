// look.ts: the look of a session (theme, ASCII, colour depth, the rich switch) read through the engine's `$.env`, once.
// The live host's hooks have no `process`, so `hostEnv()` is empty there and the only working source is `$.env.get`; every
// surface (band, HUD, side panel, board, cards, toasts, notifications) takes its Ui from this one read. `hostEnv()` stays
// only as the fallback for a host that does have a process (bun, omp) when `$.env` has nothing to say.
import type { EngineInterface } from 'claude-code';
import { hostEnv, uiFromEnv, type Ui, type UiEnv } from './atlas-ui';

export type Look = { ui: Ui; rich: boolean };

let cached: Look | null = null;

/** THE read: a Look from an environment. lookOf (after it merges `$.env` over the process) and the lookUi/lookRich fallback both build from here, so NO_COLOR, ASCII and rich cannot differ between them. */
export const readLook = (env: UiEnv): Look => ({ ui: uiFromEnv(env), rich: env.ATLAS_BAND_RICH === '1' });

const safe = async (read: () => Promise<string | undefined>): Promise<string | undefined> => {
	try { return await read(); } catch { return undefined; }
};

/** Forget the read (a new session reads the environment again). */
export function clearLook(): void {
	cached = null;
}

/** The session's look: read through `$.env` on first use, then kept. Never throws: an unreadable variable is unset. */
export async function lookOf($: EngineInterface): Promise<Look> {
	if (cached) return cached;
	// $.env.get takes a literal name (the engine lists the variables a module reads), so each read is spelled out. A host or a
	// stub with no readable `$.env` leaves the variable unset.
	const [theme, fgbg, ascii, lcAll, lcCtype, lang, noColor, colorterm, term, rich] = await Promise.all([
		safe(() => $.env.get('ATLAS_THEME')), safe(() => $.env.get('COLORFGBG')), safe(() => $.env.get('ATLAS_ASCII')),
		safe(() => $.env.get('LC_ALL')), safe(() => $.env.get('LC_CTYPE')), safe(() => $.env.get('LANG')),
		safe(() => $.env.get('NO_COLOR')), safe(() => $.env.get('COLORTERM')), safe(() => $.env.get('TERM')),
		safe(() => $.env.get('ATLAS_BAND_RICH')),
	]);
	const env: Record<string, string | undefined> = { ...hostEnv() };
	for (const [k, v] of Object.entries({ ATLAS_THEME: theme, COLORFGBG: fgbg, ATLAS_ASCII: ascii, LC_ALL: lcAll, LC_CTYPE: lcCtype, LANG: lang, NO_COLOR: noColor, COLORTERM: colorterm, TERM: term, ATLAS_BAND_RICH: rich })) if (typeof v === 'string') env[k] = v;
	cached = readLook(env);
	return cached;
}


/** The Ui for a surface whose caller passed none: the session look once read, else the process environment (bun, omp, a fixture). The one door, so NO_COLOR and ASCII agree on every surface. */
export const lookUi = (): Ui => (cached ?? readLook(hostEnv())).ui;
/** The rich switch for a surface whose caller passed none, from the same read as `lookUi`. */
export const lookRich = (): boolean => (cached ?? readLook(hostEnv())).rich;
/** A Ui from an explicit environment (a fixture or a demo that must not follow the process). */
export const uiFrom = (env: UiEnv): Ui => uiFromEnv(env);
