// @ts-check
// ISO 8601 week helpers (UTC). Weeks look like "2026-W44".

const DAY_MS = 86400000;
export const WEEK_RE = /^(\d{4})-W(\d{2})$/;

/**
 * ISO week label of a date, in UTC.
 * @param {Date} date
 * @returns {string}
 */
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.ceil(((d.getTime() - jan1) / DAY_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * Monday 00:00 UTC of an ISO week as epoch ms, or null if the label is not a real ISO week.
 * @param {string} week
 * @returns {number | null}
 */
export function weekStart(week) {
  const m = WEEK_RE.exec(week);
  if (!m) return null;
  const year = Number(m[1]);
  const wk = Number(m[2]);
  if (wk < 1 || wk > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = jan4.getTime() - (jan4Day - 1) * DAY_MS;
  const start = week1Monday + (wk - 1) * 7 * DAY_MS;
  return isoWeek(new Date(start)) === week ? start : null;
}

/**
 * The most recent fully finished ISO week.
 * @param {Date} now
 * @returns {string}
 */
export function lastFinishedWeek(now) {
  return isoWeek(new Date(now.getTime() - 7 * DAY_MS));
}

/**
 * Whole weeks between the current week and `week` (positive = past, negative = future), or null.
 * @param {string} week
 * @param {Date} now
 * @returns {number | null}
 */
export function weeksAgo(week, now) {
  const start = weekStart(week);
  const cur = weekStart(isoWeek(now));
  if (start === null || cur === null) return null;
  return Math.round((cur - start) / (7 * DAY_MS));
}
