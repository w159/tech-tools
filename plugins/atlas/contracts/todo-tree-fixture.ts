// Shared fixture: mod/todo-panel.test.ts and omp/todo-panel.test.ts both render `items` expanded at width 60 (tick 0)
// and must produce `rows` exactly (trailing spaces trimmed). A .ts module because the mod test host loads only code files.
export const fx = {
  "items": [
    {
      "id": "a",
      "content": "map the auth flow",
      "status": "completed",
      "owner": "explorer-1",
      "phase": "research"
    },
    {
      "id": "b",
      "content": "list token callers",
      "status": "pending",
      "phase": "research"
    },
    {
      "id": "c",
      "content": "edit auth middleware",
      "status": "in_progress",
      "owner": "impl-auth",
      "phase": "implement"
    },
    {
      "id": "d",
      "content": "run the suites",
      "status": "pending",
      "phase": "verify"
    },
    {
      "id": "e",
      "content": "wait on token decision",
      "status": "blocked",
      "owner": "impl-ttl"
    }
  ],
  "rows": [
    " research  1 of 2",
    "   ✓ map the auth flow · explorer-1",
    "   ○ list token callers",
    " implement  0 of 1",
    "   ◉ edit auth middleware · impl-auth",
    " verify  0 of 1",
    "   ○ run the suites",
    " other  0 of 1",
    "   ⏸ wait on token decision · impl-ttl  blocked"
  ]
};
