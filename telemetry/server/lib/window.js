// @ts-check
import { isoWeek } from "./week.js";

const WEEK_MS = 7 * 86400000;

/**
 * The last `n` ISO weeks ending with the current one, oldest first.
 * @param {Date} now
 * @param {number} n
 * @returns {string[]}
 */
export function recentWeeks(now, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(isoWeek(new Date(now.getTime() - i * WEEK_MS)));
  return [...new Set(out)];
}
