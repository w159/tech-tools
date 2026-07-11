# Org Config Schema

The org config is the single source of truth for organizational identity. It
lives at `.atlas/org-config.yaml` in the project root.

## Full schema

```yaml
# .atlas/org-config.yaml

org:
  name: "Acme Corporation"           # required: org display name
  short_name: "acme"                 # required: filesystem-safe slug
  logo: "assets/acme-logo.png"       # optional: path to org logo
  website: "https://acme.example"    # optional: org website
  description: "..."                  # optional: one-line org description

branding:
  voice: "professional"              # required: voice/tone for agent outputs
  tone_guidelines: |                  # optional: multi-line tone guide
    Use professional, concise language. Avoid jargon.
    Address the reader as "you". Use active voice.
  colors:
    primary: "#0066CC"               # optional: brand primary color
    secondary: "#FF6600"             # optional: brand secondary color
  commit_style: "conventional"       # optional: conventional | custom | none
  doc_template: ".atlas/docs/templates/acme-doc.md"  # optional: path to doc template

policies:
  compliance_frameworks:              # optional: list of applicable frameworks
    - soc2
    - hipaa
  coding_standards: ".atlas/docs/standards/coding.md"      # optional: path
  documentation_standards: ".atlas/docs/standards/docs.md" # optional: path
  approval_workflows:                                 # optional
    production_deploy: "requires-change-ticket"
    data_access: "requires-manager-approval"
    security_change: "requires-ciso-approval"
  required_artifacts:                                 # optional
    - change-log
    - approval-ticket
    - evidence-capture

departments:
  active:
    - it-operations
    - security
    - engineering
    # ... only the departments this org uses
  defaults:
    routing_notes: "Route by user role; ask if ambiguous"

connectors:
  # Connector credentials are NOT stored here.
  # This section records which connectors are provisioned.
  # Credentials live in the plugin's userConfig.
  provisioned:
    - vendor: ninjaone
      department: it-operations
      status: enabled
    - vendor: vanta
      department: security
      status: enabled
    # ... only connectors the org has set up
```

## Field reference

### org

| Field | Type | Required | Description |
|---|---|---|---|
| name | string | yes | Org display name, used in docs and reports |
| short_name | string | yes | Filesystem-safe slug (lowercase, hyphens) |
| logo | string | no | Path to org logo image (relative to project root) |
| website | string | no | Org website URL |
| description | string | no | One-line org description for README/docs |

### branding

| Field | Type | Required | Description |
|---|---|---|---|
| voice | string | yes | Voice descriptor: professional, casual, technical, etc. |
| tone_guidelines | string (multi) | no | Multi-line tone guide for agent outputs |
| colors.primary | string | no | Brand primary color (hex) |
| colors.secondary | string | no | Brand secondary color (hex) |
| commit_style | string | no | Commit message style: conventional, custom, none |
| doc_template | string | no | Path to org document template |

### policies

| Field | Type | Required | Description |
|---|---|---|---|
| compliance_frameworks | list | no | Frameworks the org must follow: soc2, hipaa, iso27001, etc. |
| coding_standards | string | no | Path to org coding standards doc |
| documentation_standards | string | no | Path to org documentation standards doc |
| approval_workflows | map | no | Per-action approval requirements |
| required_artifacts | list | no | Artifacts that must accompany certain work types |

### departments

| Field | Type | Required | Description |
|---|---|---|---|
| active | list | yes | Which departments are active for this org |
| defaults.routing_notes | string | no | Project-specific routing guidance |

### connectors

| Field | Type | Required | Description |
|---|---|---|---|
| provisioned | list | no | Record of provisioned connectors (credentials are in userConfig) |

## Loading

Armada loads the org config on activation. If the file does not exist, armada
offers guided setup. The config is cached for the session and reloaded on
change.

## Branding enforcement flow

1. Department agent is activated for a task
2. Armada loads org branding from the config
3. The agent receives the branding context (voice, tone, colors, template)
4. All outputs the agent produces carry the org branding
5. Armada does not rewrite outputs after the fact -- branding is loaded
   before work begins

## Policy compliance flow

1. Armada loads compliance frameworks from the config
2. For each framework, the relevant policy constraints are made available to
   all agents
3. When an agent performs compliance-sensitive work, it references the
   applicable framework
4. Required artifacts (change logs, approval tickets, evidence) are flagged
5. The agent guides the end user to follow the correct procedure