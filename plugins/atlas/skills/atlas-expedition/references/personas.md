# Personas: generation via datagen.py

Personas are synthesized by the harness script datagen.py, not hand-authored. The
generator reads the discovered field matrix and contract-snapshot.json produced by
Phase 0 discovery, so it adapts to whatever web app is under test.
Generation is deterministic: the same seed yields identical rows, so a run is
repeatable and diffable.

## Discovery-driven schema

There is no fixed column list baked into this skill. datagen.py reads the field matrix
handed in by the cartographer (or a contract-snapshot.json written to the run dir) and
derives persona attributes from it. For each discovered field the generator maps the
field type to a generation strategy:

| Field type     | Valid-profile strategy                          | Boundary-trap strategy                        |
|----------------|-------------------------------------------------|-----------------------------------------------|
| text / string  | Realistic value within min/max length           | Empty string, max-length overrun, or whitespace-only |
| number / int   | Value within stated min/max range               | Zero, negative, below-min, or above-max value |
| currency       | Positive value within plausible range           | Zero, negative, or extreme large value        |
| date           | Past or present date appropriate to the field   | Future date, epoch zero, or pre-epoch value   |
| enum / select  | One of the allowed option values                | Value not in the allowed list                 |
| boolean        | True or false as appropriate for the context    | Null or missing value                         |
| cross-field    | Consistent values across related fields         | Deliberate inconsistency (e.g. count field    |
|                | (e.g. list length matches a count field)        | does not match list length)                   |

Required fields (as declared in the contract snapshot) always receive a value in the
valid profile. The boundary profile leaves required fields empty or invalid to exercise
the app's validation path.

## profile semantics (skill option -> datagen profile)

The skill exposes profile=valid|mixed (default mixed). datagen itself has three profiles:
- valid    - clean happy-path data that should pass every step.
- boundary  - every row is a known trap shape (used internally; not a skill option).
- mixed    - mostly valid, but every 4th persona (index i % 4 == 3) is mutated into a
             boundary trap. This is what the skill's profile=mixed maps to.

The five trap shapes a boundary mutation applies (chosen per row from the seed):
- zero_numeric: sets a required numeric or currency field to zero.
- future_date:  sets a date field to a future date relative to run time.
- overlimit:    sets a text or numeric field to a value one unit above its declared max.
- missing_required: omits a required field entirely.
- cross_field_mismatch: sets two related fields to internally inconsistent values (e.g.
  a count field and a list-length field disagree).

These five trap shapes are the regression surface -- each maps to a previously found
class of validation bug. The generator picks the applicable shapes for each row based on
which field types the discovered contract exposes; if a trap shape has no applicable
field in the current app, it is skipped for that row.

## Seed repeatability

GEN_SEED (CLI --seed) makes generation deterministic: same seed + same count + same
profile + same field matrix = byte-identical rows. Default is random, so omit GEN_SEED
for fresh data; set it to reproduce a prior run exactly or to diff two runs on identical
inputs. Account ids are assigned stably (P01, P02, ... or an explicit --ids list) so
existing run-scoped accounts are reused while the entry DATA regenerates.

## User-count presets and the coverage cap

The skill's users option accepts an integer or one of the presets 6 / 12 / 24 (default
12), mapped to datagen --count via the COUNT env knob. 24 is the full seed-equivalent
set; 6 and 12 are lighter passes.

The coverage tier caps user count: coverage=smoke caps users at 2 regardless of the
requested count. If users and coverage conflict (e.g. users=24 coverage=smoke), the
coverage cap wins for user count and the conflict is recorded in the run log. standard
and full honor the requested count.

## Harness contract (what datagen.py must honor)

datagen.py is not part of this plugin tree; it lives in the run dir alongside the
scripted harness. This section defines the contract it must honor so the atlas-expedition
skill can drive it correctly:

- Reads field matrix from: RUN_DIR/field-matrix.json (written by the cartographer phase)
  OR from contract-snapshot.json in the same dir (preferred if present).
- Writes output to:         RUN_DIR/generated-personas.csv (one row per persona, columns
  matching the field ids from the discovered matrix, plus persona_id and expected_signal).
- expected_signal is a hypothesis column -- a plain-English string describing the outcome
  the persona is designed to trigger. It is a hypothesis to confirm or refute, never
  ground truth.
- Accepts CLI flags: --count N, --seed N, --profile valid|boundary|mixed,
  --ids "P01 P02 ...", --out <path>.
- Must not hardcode any application-specific field names, domain values, or department
  labels. All field ids come from the discovered matrix at runtime.

## Standalone use

datagen.py runs standalone for inspection or fixture generation:
  python3 datagen.py --count 12 --seed 7 --profile mixed --out generated-personas.csv
  python3 datagen.py --count 6 --profile valid --ids "P01 P02 P03 P04 P05 P06" --out gen.csv
The skill writes generated rows to RUN_DIR/generated-personas.csv before the scripted wave.
