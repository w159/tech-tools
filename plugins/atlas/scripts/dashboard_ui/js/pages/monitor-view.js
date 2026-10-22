// Window control shared by the monitor pages.
import { Segmented } from "../ui.js";
import { WINDOWS, normalizeWindow } from "./monitor-model.js";

/** Window Segmented bound to the hash (window=24h|7d|30d). */
export function WindowControl(ctx) {
  return Segmented({
    label: "Time window",
    options: WINDOWS,
    value: normalizeWindow(ctx.params.window),
    onChange: (w) => ctx.setParams({ window: w }),
  });
}
