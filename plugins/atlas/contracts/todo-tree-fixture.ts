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
    " I. Research 1/2",
    "   ✔  explorer-1  map the auth flow",
    "   ○              list token callers",
    " II. Implement 0/1",
    "   ⠋  impl-auth   edit auth middleware",
    " III. Verify 0/1",
    "   ○              run the suites",
    " IV. Other 0/1",
    "   ✖  impl-ttl    wait on token decision"
  ]
};
