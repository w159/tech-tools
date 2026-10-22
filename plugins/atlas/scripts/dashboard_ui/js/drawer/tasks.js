// Drawer Tasks tab: board items owned by, claimed by or launched into this agent.
// render(ctx, row) draws into ctx.root. ctx: {root, project}.
import { h, replace, relTime } from "../dom.js";
import { Badge, Empty } from "../ui.js";
import { get, describeError } from "../api.js";
import { buildHash } from "../router.js";
import { todosFor } from "../pages/agents-model.js";
import { STATUS_TONE, statusLabel } from "../pages/board-model.js";

export async function render(ctx, row) {
  replace(ctx.root, h("p", { class: "meta pad" }, "Loading..."));
  let disposed = false;
  try {
    const state = await get("/api/v2/todos", { project: ctx.project });
    if (disposed) return () => {};
    const items = todosFor(state, row);
    if (!items.length) {
      replace(
        ctx.root,
        Empty({ title: "No tasks.", body: `${row.name} has no board tasks.` }),
      );
    } else {
      replace(
        ctx.root,
        h(
          "ul",
          { class: "task-list" },
          items.map((t) =>
            h(
              "li",
              { class: "task" },
              h("div", {}, t.content),
              h(
                "div",
                { class: "task-meta meta" },
                Badge(statusLabel(t.status), STATUS_TONE[t.status]),
                relTime(t.updated),
                h(
                  "a",
                  {
                    href: buildHash("board", {
                      status: t.status,
                      project:
                        t.project || (ctx.project !== "all" ? ctx.project : ""),
                    }),
                  },
                  "Open on board",
                ),
              ),
            ),
          ),
        ),
      );
    }
  } catch (e) {
    replace(
      ctx.root,
      Empty({ title: "Tasks did not load.", body: describeError(e).message }),
    );
  }
  return () => {
    disposed = true;
  };
}
