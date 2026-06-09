# GDPR Engineering

Sourced from the gdpr-compliant skill. Actionable GDPR reference for engineers, architects,
DevOps, and tech leads. Inspired by CNIL developer guidance and GDPR Articles 5, 25, 32,
33, 35.

> Golden Rule: Collect less. Store less. Expose less. Retain less.

## 1. Core GDPR Principles (Article 5)

| Principle | Engineering obligation |
|---|---|
| Lawfulness, fairness, transparency | Document legal basis for every processing activity in the RoPA |
| Purpose limitation | Data collected for purpose A MUST NOT be reused for purpose B without a new legal basis |
| Data minimization | Collect only fields with a documented business need today |
| Accuracy | Provide update endpoints; propagate corrections to downstream stores |
| Storage limitation | Define TTL at schema design time -- never after |
| Integrity and confidentiality | Encrypt at rest and in transit; restrict and audit access |
| Accountability | Maintain evidence of compliance; RoPA ready for DPA inspection at any time |

## 2. Privacy by Design and by Default

MUST:
- Add `CreatedAt`, `RetentionExpiresAt` to every table holding personal data at creation time.
- Default all optional data collection to OFF. Users opt in; they never opt out of a
  default-on setting.
- Conduct a DPIA before building high-risk processing (biometrics, health data, large-scale
  profiling, systematic monitoring).
- Update the RoPA with every new feature that introduces a processing activity.
- Sign a DPA with every sub-processor before data flows to them.

MUST NOT:
- Ship a new data collection feature without a documented legal basis.
- Enable analytics, tracking, or telemetry by default without explicit consent.
- Store personal data in a system not listed in the RoPA.

## 3. Data Minimization

MUST:
- Map every DTO/model field to a concrete business need. Remove undocumented fields.
- Use separate DTOs for create, read, and update -- never reuse the same object.
- Return only what the caller is authorized to see -- use response projections.
- Mask sensitive values at the edge: return `****1234` for card numbers, never the full value.
- Exclude sensitive fields (DOB, national ID, health) from default list/search projections.

MUST NOT:
- Log full request/response bodies if they may contain personal data.
- Include personal data in URL path segments or query parameters.
- Collect `dateOfBirth`, national ID, or health data without an explicit legal basis.

## 4. Storage Limitation and Retention

Every table holding personal data MUST have a defined retention period.
Enforce retention automatically via a scheduled job (Hangfire, cron) -- never manual.
Anonymize or delete data when retention expires -- never leave expired data silently in
production.

Recommended defaults:

| Data type | Max retention |
|---|---|
| Auth / audit logs | 12-24 months |
| Session / refresh tokens | 30-90 days |
| Email / notification logs | 6 months |
| Inactive user accounts | 12 months after last login -> notify -> delete |
| Payment records | As required by tax law (7-10 years), minimized |
| Analytics events | 13 months |

## 5. API Design Rules

MUST:
- MUST NOT include personal data in URL paths or query parameters.
- Authenticate all endpoints that return or accept personal data.
- Extract the acting user's identity from the JWT -- never from the request body.
- Validate ownership on every resource: `if (resource.OwnerId != currentUserId) return 403`.
- Use UUIDs or opaque identifiers -- never sequential integers as public resource IDs.

MUST NOT:
- Return stack traces, internal paths, or database errors in API responses.
- Use `Access-Control-Allow-Origin: *` on authenticated APIs.

## 6. Logging Rules

MUST:
- Anonymize IPs in application logs -- mask last octet (IPv4) or last 80 bits (IPv6).
- MUST NOT log: passwords, tokens, session IDs, credentials, card numbers, national IDs,
  health data.
- MUST NOT log full request/response bodies where PII may be present.
- Enforce log retention -- purge automatically after the defined period.

SHOULD:
- Log events not data: "User {UserId} updated email" not "Email changed from a@b.com to c@d.com".
- Use structured logging (JSON) with `userId` as an internal identifier, not the email address.
- Separate audit logs from application logs -- different retention and ACLs.

## 7. Encryption

| Scope | Minimum standard |
|---|---|
| Standard personal data | AES-256 disk/volume encryption |
| Sensitive data (health, financial, biometric) | AES-256 column-level + envelope encryption via KMS |
| In transit | TLS 1.2+ (prefer 1.3); HSTS enforced |
| Keys | HSM-backed KMS; rotate DEKs annually |

MUST NOT allow TLS 1.0/1.1, null cipher suites, or hardcoded encryption keys.

## 8. Password Hashing

MUST:
- Use Argon2id (recommended) or bcrypt (cost >= 12). Never MD5, SHA-1, or SHA-256.
- Use a unique salt per password. Store only the hash.

## 9. Secrets Management

MUST:
- Store all secrets in a KMS: Azure Key Vault, AWS Secrets Manager, GCP Secret Manager,
  or HashiCorp Vault.
- Use pre-commit hooks (`gitleaks`, `detect-secrets`) to prevent secret commits.
- Rotate secrets on developer offboarding, annual schedule, or suspected compromise.

## 10. Anonymization and Pseudonymization

- Anonymization = irreversible -> falls outside GDPR scope. Use for retained records after
  erasure.
- Pseudonymization = reversible with a key -> still personal data, reduced risk.
- When erasing a user, anonymize records that must be retained (financial, audit) rather than
  deleting them.
- Store the pseudonymization key in the KMS -- never in the same database as the
  pseudonymized data.
- MUST NOT call data "anonymized" if re-identification is possible through linkage attacks.

## 11. PR Review Checklist

### Data model
- Every new PII column has a documented purpose and retention period.
- Sensitive fields (health, financial, national ID) use column-level encryption.
- No sequential integer PKs as public-facing identifiers.

### API
- No PII in URL paths or query parameters.
- All endpoints returning personal data are authenticated.
- Ownership checks present.
- Rate limiting applied to sensitive endpoints.

### Logging
- No passwords, tokens, or credentials logged.
- IPs anonymized.
- No full request/response bodies logged where PII may be present.

### Infrastructure
- No public storage buckets or public-IP databases.
- New cloud resources tagged with `DataClassification`.
- Encryption at rest enabled for new storage resources.
- New geographic regions for data storage are EEA-compliant or covered by SCCs.

### Secrets and CI/CD
- No secrets in source code or committed config files.
- New secrets added to KMS and secrets inventory document.
- CI/CD secrets masked in pipeline logs.

### Retention and erasure
- Retention enforcement job or policy covers new data store or field.
- Erasure pipeline updated to cover new data store.

### User rights and governance
- Data export endpoint includes any new personal data field.
- RoPA updated if a new processing activity is introduced.
- New sub-processors have a signed DPA and a RoPA entry.
- DPIA triggered if the change involves high-risk processing.

## 12. Anti-Patterns

| Anti-pattern | Correct approach |
|---|---|
| PII in URLs | Opaque UUIDs as public identifiers |
| Logging full request bodies | Log structured event metadata only |
| "Keep forever" schema | TTL defined at design time |
| Production data in dev/test | Synthetic data + scrubbing pipeline |
| Shared credentials across teams | Individual accounts + RBAC |
| Hardcoded secrets | KMS + secret manager |
| `Access-Control-Allow-Origin: *` on auth APIs | Explicit CORS allowlist |
| Storing consent with profile data | Dedicated consent store |
| PII in GET query params | POST body or authenticated session |
| Sequential integer IDs in public URLs | UUIDs |
| "Anonymized" data with quasi-identifiers | Apply k-anonymity, test linkage resistance |
