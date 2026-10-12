// Pure poll scheduling: how long to wait before the next poll after `failures` consecutive errors.
// Auth failures (401/403) never recover by retrying, so the caller stops and shows "reload the page".
export const MAX_POLL_BACKOFF_MS = 60000;
const AUTH_STATUSES = new Set([401, 403]);

export const isAuthFailure = (err) => AUTH_STATUSES.has(err?.status);

export function nextPollDelay(baseMs, failures, err) {
  if (isAuthFailure(err)) return null;
  return Math.min(baseMs * 2 ** Math.min(failures, 10), MAX_POLL_BACKOFF_MS);
}

export const SESSION_EXPIRED_TEXT = "Session expired, reload the page.";
