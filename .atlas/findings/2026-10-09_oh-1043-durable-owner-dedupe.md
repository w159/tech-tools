# OH-1043-durable-owner-dedupe: ingest_transcript durable_owner: repeated temp copies re-read from byte 0 do not double rows

- id: OH-1043-durable-owner-dedupe
- status: verified
- verified_by: SessionVerifier
- verified_at: 2026-10-09T15:12:54+00:00

## Evidence
- throwaway script, temp ATLAS_DB/ATLAS_HOME/HOME, ATLAS_HARNESS=omp: durable non-tmp file ingested -> messages 4, tool_calls 2, user_prompts 1
- two distinct /var/folders/.../atlas-ingest-*/ copies of identical content -> counts stay 4/2/1 (no doubling)
- grown copy (+1 user line) -> 5/2/2, session_logs transcript_path stays durable, file_size 1244->1469, ended_at advanced, model/cwd set
- dedupe is by UNIQUE indexes atlas_db.py:98,108,113,119 + INSERT OR IGNORE
- side notes: ingest stats report attempted (not inserted) counts; ingest_files keeps one row per temp copy path (temp paths accumulate in ingest_files)

## Reproduction
python3 /var/folders/.../sv-home-*/t.py with ATLAS_DB=<tmp>/t.db

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
