# Forensic Audit Rubric

Evaluation criteria for ThreatLocker Action Log investigations. Use this
rubric to grade the completeness and quality of a forensic timeline before
delivering findings.

## Evidence Quality Tiers

| Tier | Signal Strength | Description |
|------|----------------|-------------|
| A - Definitive | High | Multiple corroborating action entries, full process chain, known signer, cross-host correlation |
| B - Strong | Medium | Single action with full detail, or multiple actions with partial context |
| C - Weak | Low | Truncated process chain, missing parent, or single event without correlation |
| D - Insufficient | None | Cannot confirm or deny; needs more data or manual review |

## Timeline Completeness Checklist

1. **Time window scoped** - Start and end bounds defined in ISO 8601 UTC.
2. **Patient zero identified** - Earliest occurrence of the IOC pinned with actionId.
3. **Lateral movement mapped** - Every host that saw the same fileHash listed with first-seen time.
4. **Block vs Permit classified** - Each action tagged Block, Permit, or Audit.
5. **Process chain captured** - Parent process recorded or flagged as truncated.
6. **User context included** - userName on every action where available.
7. **Policy correlation** - Cross-referenced with recent approval decisions.

## Red Flags That Downgrade Confidence

- Process chain is empty or `unknown` on the primary suspicious action.
- All evidence is Audit-only with no Block or Permit to confirm execution outcome.
- Single host with no lateral spread (could be isolated, could be incomplete).
- Time gap > 1h between adjacent actions in a supposed continuous chain.
- Duplicate-looking events that share the same actionId (data error, not corroboration).

## Output Grading

Before delivering findings, assign one grade to the overall investigation:

| Grade | Meaning | Action |
|-------|---------|--------|
| PASS | Tier A or B evidence, timeline complete | Deliver findings with actionId references |
| PASS-WITH-CAVEATS | Tier B or C, timeline has minor gaps | Deliver with explicit caveats listed |
| NEEDS-MORE-DATA | Tier C or D, critical gaps | State what data is missing and what to pull next |
| INCONCLUSIVE | Tier D, cannot reconstruct | Escalate to manual portal investigation |