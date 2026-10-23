# results.csv row schema

One header, one row per scenario, UTF-8, comma separated, quote fields containing commas.
Every role writes `RUN_DIR/evidence/<id>-<kind>.rows.csv` with this header; the synthesis
reporter concatenates them into `RUN_DIR/reports/results.csv`.

```
run_id,persona_id,phase,route,selector,field_id,scenario,input,app_value,expected_value,delta,relation,verdict,classification,severity,evidence_ref,notes
```

| Column | Meaning |
|---|---|
| run_id | RUN_DIR directory name |
| persona_id | persona or agent id that produced the row |
| phase | enter-data, walk-ui, fuzz, verify |
| route / selector | where it happened (blank for API-only rows) |
| field_id | field id from the field matrix (blank if not field-level) |
| scenario | one-line description of the case |
| input | value submitted (no real PII or credentials) |
| app_value / expected_value / delta | displayed vs recomputed value; delta in cents for money |
| relation | metamorphic relation checked (blank if none) |
| verdict | pass, fail, unverifiable, failed-to-run |
| classification | frontend, backend, slipped (accepted bad input), or n/a |
| severity | Nielsen 0-4 |
| evidence_ref | path relative to RUN_DIR; must exist on disk |
| notes | short free text |
