# Testing infrastructure as code, containers, and CI pipelines

Covers Terraform, Bicep, Dockerfiles and images, Kubernetes manifests, GitHub Actions, Azure Pipelines, and pre-commit as the local test gate. Infrastructure "code" is usually validated rather than unit tested: the cheapest tests are static (fmt, lint, schema), the next tier renders the config and asserts on the result (plan, what-if, mocks), and the most expensive deploys into ephemeral environments and probes the result. Scale testing effort with blast radius: a module that provisions a database holding client data (regulated under FTC Safeguards, SEC Reg S-P, GLBA) deserves the deeper tiers; a lint-only pipeline does not.

## At a glance

One row per applicable type id. Where the tool differs by area, the row names the tool per area.

| TYPE ID | Tool (current version) | Install | Run | Notes |
| --- | --- | --- | --- | --- |
| static-lint | Terraform: tflint plus terraform fmt/validate. Bicep: bicep build --stderr (lint rules). Dockerfile: hadolint v2.15. Kubernetes: kube-linter, Polaris. CI: actionlint | brew/pip/npm per tool; actionlint static binary; hadolint binary | terraform fmt -check -recursive; tflint --recursive; bicep lint; hadolint Dockerfile; kube-linter manifests/; polaris audit --audit-path k8s/; actionlint | Bicep lint rules are configured in bicepconfig.json under analyzers; set rule level to Error to fail the build |
| type-check | terraform validate; bicep build; kubeconform (schema validation) | built in; kubeconform binary or brew | terraform validate; bicep build file.bicep; kubeconform -strict -summary k8s/ | These are the "does it compile and is the schema right" tier; run before anything else |
| unit | terraform test (.tftest.hcl) with mock_provider; `bicep snapshot` for local-only normalized JSON comparison | Terraform 1.6+ for tests, 1.7+ for mocks (feature-gated in CLI, no install) | terraform test (runs every *.tftest.hcl) | With command = plan or mocks, no cloud credentials or real resources are needed; Bicep test framework is experimental (enable testFramework in bicepconfig.json) |
| integration | Terratest (Go); Chainsaw (Kyverno); Bicep: az deployment group what-if with Pester assertions on the result | Terratest: Go dep in _test.go; chainsaw: brew or release binary; Pester: PowerShell Gallery | go test ./tests/...; chainsaw test; pester run over what-if JSON | PR-safe version: plan-only terraform test, what-if, chainsaw against a kind cluster. Real-infrastructure Terratest belongs on a schedule |
| e2e | Terratest against a real (nightly) environment; Chainsaw multi-step assertions | same as integration | go test -run TestDeploy ./tests/nightly/... | Full deploy, probe outputs, destroy. Cost and time heavy; nightly or weekly |
| iac-policy | Checkov (maintained by Prisma Cloud), Trivy (Aqua), KICS (Checkmarx), OPA/Conftest for custom policy, PSRule for Azure (Bicep), ARM-TTK (see notes), Infracost as a cost check | checkov: pip; trivy: brew; kics binary; conftest binary; PSRule: Install-Module PSRule.Rules.Azure; infracost binary | checkov -d .; trivy config .; kics scan -p .; conftest test terraform.tfplan.json; Invoke-PSRule -Module PSRule.Rules.Azure -InputPath out/; infracost-ci diff | Pick ONE broad scanner per repo (Checkov or Trivy) plus a policy gate (Conftest) and, for Azure/Bicep, PSRule for Azure 1.47. ARM-TTK is still released but frozen scope: Bicep contains all deploymentTemplate cases since 0.10, so use Bicep linter + PSRule; keep TTK only for raw JSON ARM and createUiDefinition |
| container-scan | Trivy, Grype (with Syft SBOM), Docker Scout (built into Docker) | trivy brew; syft/grype brew; docker scout cves | trivy image --severity HIGH,CRITICAL img:tag; grype img:tag | Run in PR on the built image; gate on HIGH/CRITICAL with a fixable-only filter to cut noise |
| secrets | gitleaks or trufflehog in pre-commit and CI; Checkov/Trivy also have secret checks; GitHub secret scanning + push protection | gitleaks brew; trufflehog brew | gitleaks detect --no-banner | IaC templates and CI logs leak credentials constantly; scan diffs of tfvars, .bicepparam, workflow files |
| ci-pipeline | actionlint (workflow syntax); zizmor (CI security audit, docs.zizmor.sh); act (local runs); pinned SHAs for actions; pre-commit as the first gate | actionlint binary; zizmor: pip/brew/cargo; act brew; pre-commit pip | actionlint; zizmor .; act -j build; pre-commit run --all-files | Pin third-party actions to full commit SHA and let Dependabot update them. zizmor audits unpinned uses, template injection, credential persistence, and reads pre-commit configs too |
| smoke | docker compose healthcheck; container-structure-test; kubectl rollout status / get events post-deploy | compose built in; container-structure-test 1.22 binary | container-structure-test test --image img:tag --config tests.yaml | container-structure-test is GoogleContainerTools, maintenance mode, but fine for file/metadata/command assertions on images |
| differential | terraform plan diff before/after a change; az deployment what-if output diffed between branches; kubectl server-side dry-run | built in | terraform plan -out tf.plan; terraform show -json > plan.json | The plan JSON is the contract: assert that only intended resources changed (jq on resource_changes) |
| combinatorial | tfvars/workspace/targets matrix in CI | none | CI matrix job: terraform plan per var file | Cheap; catches region-, env-, and size-dependent configuration errors |
| regression | drift detection: terraform plan -detailed-exitcode on a schedule; Atlas drift (db side, see data file); Infracost diff as cost regression | built in | scheduled CI job running terraform plan | Any non-empty plan on an expected-clean state is drift; page or fail the job |
| chaos | Kubernetes: Chaos Mesh, Litmus, Kyverno experiment tooling | brew or manifests | scheduled against a staging cluster | Runs against the deployed stack, not against IaC files; keep out of PR |
| benchmark | n/a (closest: Infracost cost budgets) | | | Cost is the only "performance metric" IaC exposes; treat Infracost thresholds as the budget |
| load | n/a for IaC files; run load tools (k6, Locust) against the system the IaC deploys; see types-nonfunctional.md | | | |
| coverage | n/a as line coverage; use scanner output as inventory: count policies evaluated vs passed in Checkov/Conftest reports | | | |

Not applicable (with reason): property-based, fuzz, metamorphic (no execution surface to mutate; negative policy tests below are the useful analogue); model-based (policy-as-code in Conftest/OPA is the nearest form); snapshot-approval (plan JSON differs legitimately run to run; assert on resource_changes fields instead); characterization; acceptance-bdd; unit-coverage style tooling for Bicep beyond lint is experimental; accessibility, visual-regression, cross-browser, i18n, usability, exploratory (human-led; see types-nonfunctional.md and types-functional.md); mutation (replaced by negative policy tests: an intentionally insecure resource must FAIL the Conftest/Checkov gate, and an intentionally bad tfvar must fail terraform test expect_failures); sast/sca/dast/authz on app code belong to types-security.md; data-quality, db-migration to data-sql-databases.md; docs-examples to docs-notebooks-web-assets.md.

## Recommended default stack

- Terraform modules: terraform fmt -check + validate + tflint in pre-commit; terraform test with mock_provider (plan-based) per module in PR; one broad scanner (Checkov or Trivy) in PR; Infracost diff comment in PR; Terratest nightly for modules handling client data; scheduled drift job.
- Bicep: bicep build --stderr (lint to Error for the rules you care about via bicepconfig.json) + PSRule for Azure on the expanded template in PR; what-if as the change preview and Pester assertions on what-if JSON for non-negotiables; bicep snapshot for credential-free regressions of intended logic; ARM-TTK only if raw ARM JSON or createUiDefinition still exists.
- Dockerfile/image: hadolint + trivy config in PR on the Dockerfile; build, then trivy image and container-structure-test (or compose healthcheck) in PR on the image.
- Kubernetes manifests: kubeconform -strict + kube-linter in pre-commit; Polaris audit for readiness/security posture; Conftest/OPA for your own org rules; Chainsaw for behavior tests against kind in PR or nightly.
- CI itself: actionlint on every workflow change; zizmor in PR; actions pinned to commit SHAs, Dependabot updating them; act only to reproduce a failing job locally.
- pre-commit as the universal gate: fmt/lint/secret hooks locally and in CI before any cloud call.

## Config snippets

Terraform native test with mocks (verified syntax, Terraform docs):

```hcl
# tests/example.tftest.hcl
mock_provider "azurerm" {}

run "name_is_correct" {
  command = plan
  variables { rg_name = "rg-app" }
  assert {
    condition     = azurerm_resource_group.rg.name == var.rg_name
    error_message = "resource group name wrong"
  }
}

run "rejects_bad_tag" {
  command = plan
  variables { rg_name = "rg-app", environment = "prod with spaces" }
  expect_failures = [var.environment]
}
```

tflint.hcl:

```hcl
plugin "terraform" { enabled = true }
plugin "azurerm" { enabled = true }   # provider rules catch invalid SKUs, names, regions
rule "terraform_deprecated_interpolation" { enabled = true }
```

Checkov plan scan (catches issues after variable expansion, needs jq for line numbers):

```sh
terraform init -backend=false
terraform plan -out tf.plan && terraform show -json tf.plan | jq '.' > tf.json
checkov -f tf.json
```

Conftest policy and negative test (the IaC "mutation" replacement):

```rego
package main
deny[msg] {
  r := input.resource_changes[_]
  r.type == "azurerm_storage_account"
  r.change.after.https_traffic_only_enabled != true
  msg := sprintf("storage %s must force https", [r.address])
}
```

```sh
conftest test tf.json
# negative test: a fixture tf.json with insecure config must exit nonzero
conftest test fixtures/insecure.json && echo "policy gate FAILED to reject bad config" || true
```

bicepconfig.json lint levels (from Microsoft docs; Error fails the build):

```json
{
  "analyzers": {
    "core": {
      "enabled": true,
      "rules": {
        "no-hardcoded-env-urls": { "level": "warning" },
        "use-recent-api-versions": { "level": "error" },
        "what-if-short-circuiting": { "level": "warning" }
      }
    }
  }
}
```

What-if plus Pester assertion (Azure CLI 2.76+ supports --validation-level; default Provider does RBAC checks):

```sh
az deployment group what-if --resource-group rg-app --template-file main.bicep --no-pretty-print > whatif.json
```

```powershell
Describe "what-if guardrails" {
  It "deletes nothing" {
    ($changes | Where-Object changeType -eq 'Delete').Count | Should -Be 0
  }
}
```

PSRule for Azure 1.47 (module + GitHub Actions/Azure Pipelines tasks exist):

```powershell
Install-Module PSRule.Rules.Azure -Scope CurrentUser
Import-Module PSRule.Rules.Azure
Assert-PSRule -Module PSRule.Rules.Azure -InputPath ./ -Format File -Baseline 'Azure.GA_2025_12'
```

Dockerfile and image checks:

```sh
hadolint Dockerfile
trivy config .          # Dockerfile + IaC misconfigurations
trivy image --severity HIGH,CRITICAL app:PR-42
container-structure-test test --image app:PR-42 --config tests/structure.yaml
docker compose config   # validates compose file before any up
```

```yaml
# tests/structure.yaml (container-structure-test, schemaVersion 2.0.0)
schemaVersion: 2.0.0
fileExistenceTests:
  - name: entrypoint exists
    path: /app/entrypoint.sh
    shouldExist: true
metadataTest:
  exposedPorts: ["8080"]
  workdir: /app
```

compose healthcheck as smoke (docker marks unhealthy; CI polls):

```yaml
services:
  api:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/healthz"]
      interval: 5s
      retries: 12
```

Kubernetes manifest tests:

```sh
kubeconform -strict -summary -schema-location default \
  -schema-location 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json' k8s/
kube-linter lint k8s/
polaris audit --audit-path k8s/
conftest test k8s/
chainsaw test tests/chainsaw/     # against a kind cluster
```

Chainsaw test (declarative steps, positive and negative assertions):

```yaml
# tests/chainsaw/test-policy.yaml
apiVersion: chainsaw.kyverno.io/v1alpha1
kind: Test
metadata:
  name: deny-privileged-pod
spec:
  steps:
    - try:
        - apply:
            resource:
              apiVersion: v1
              kind: Pod
              metadata: { name: bad-pod }
              spec:
                containers:
                  - name: c
                    image: nginx
                    securityContext: { privileged: true }
        - shouldFail:      # negative assertion: creation must be rejected
            apply:
              resource:
                apiVersion: v1
kind: Test
```

(Write each Chainsaw test in a single document; the fragment above shows the shouldFail idea in place. Use `chainsaw test` for JUnit output: --report-format JUnit --report-name report.xml.)

GitHub Actions hygiene:

```sh
actionlint                          # workflow syntax, expression checks
zizmor .                            # security audit; offline by default unless GH_TOKEN set
act -j build                        # local run; no real secrets, services limited
```

pre-commit gate:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: terraform-fmt
        entry: terraform fmt -check -recursive
        language: system
        pass_filenames: false
      - id: tflint
        entry: tflint --recursive
        language: system
        pass_filenames: false
      - id: hadolint
        entry: hadolint
        language: system
        files: Dockerfile.*
      - id: gitleaks
        entry: gitleaks detect --no-banner --redact
        language: system
        pass_filenames: false
  - repo: https://github.com/antonbabenko/pre-commit-terraform
    rev: v1.100.0
    hooks: [terraform_validate, terraform_tflint]
```

Azure Pipelines notes: use Pester v5 for any PowerShell-based deployment validation (Assert-Pester on what-if JSON is the common pattern); PSRule for Azure has an official Azure Pipelines task; zizmor/actionlint also work in Azure Pipelines as plain script steps; pin task versions and prefer self-hosted pools for regulated data.

## Gotchas

- PR vs nightly: lint, schema checks, mocked terraform tests, static scans, what-if, Conftest, image scans, and Chainsaw-on-kind all belong in PR. Real-infrastructure Terratest, chaos, drift jobs (scheduled plan), and load belong on schedules. This split keeps PRs credential-light and fast.
- Terraform license: HashiCorp moved Terraform to the BSL license in 2023; OpenTofu is the MPL fork. terraform test syntax (1.6 tests, 1.7 mocks) is the same surface tested here; verify your pinned CLI matches what CI installs.
- Mocked providers generate random strings for unknown computed values; never assert on generated values, only on values you set or that `override_during = plan` pins.
- what-if noise: some properties appear as deleted/modified only because secure or runtime values are not evaluated; what-if cannot resolve reference() or secure parameters. Assert on change types and stable properties, not full payload equality. `bicep snapshot` avoids this entirely for local logic comparisons (no Azure connection), while what-if validates real ARM-side semantics.
- Bicep test framework and assertions are experimental; do not gate production deploys on them yet.
- Conftest gives you exactly the rules your org cares about; scanners give you industry baseline. Negative policy tests (bad fixtures must fail) are how you test the gates themselves.
- Infracost: `infracost-ci diff --base-path --head-path` in the `ghcr.io/infracost/ci:2` container computes estimates from code (no terraform/plan needed); guardrails can make the check red and block; code is parsed in the runner, only estimates leave. Needs a CLI token secret.
- container-structure-test is in explicit maintenance mode; still the easiest file/metadata assertion tool for images. Trivy has no structural-equivalent, so do not confuse CVE scanning with structure testing.
- kuttl: kudobuilder/kuttl is active again (v0.27.0, Sep 2026) but the Kyverno ecosystem standardized on Chainsaw, which ships kuttl migration commands (`chainsaw migrate kuttl tests`); the kyverno kuttl mirror is archived.
- act cannot run reusable workflows, secrets, or some actions faithfully; treat act output as a reproduction aid, never as the gate.
- Pin third-party actions to commit SHA (zizmor checks this among many audits); Dependabot keeps pins current. For pre-commit remote hooks the same rule applies (pinned rev).
- Kubernetes tests in PR need a cluster tool: kind for local CI; Chainsaw supports dynamic (ephemeral) clusters.
- Do not run terraform apply in PR CI against shared state; test with plan/mocks, or point PR jobs at ephemeral workspaces with unique state keys.
- PSRule for Azure: baselines are dated (Azure.GA_2025_12); pin a baseline date so new rules do not randomly break old pipelines; version 2 renames several config options (see changelog).

## Sources

- Terraform tests: https://developer.hashicorp.com/terraform/language/tests
- Terraform mocking: https://developer.hashicorp.com/terraform/language/tests/mocking
- tflint: https://github.com/terraform-linters/tflint
- Terratest: https://github.com/gruntwork-io/terratest
- Checkov: https://github.com/bridgecrewio/checkov
- Trivy (IaC and image): https://github.com/aquasecurity/trivy
- KICS: https://docs.kics.io/latest/
- Conftest: https://github.com/open-policy-agent/conftest
- Infracost GitHub Actions: https://www.infracost.io/docs/integrations/github_actions/
- Bicep lint config: https://learn.microsoft.com/azure/azure-resource-manager/bicep/bicep-config-linter
- Bicep what-if: https://learn.microsoft.com/azure/azure-resource-manager/bicep/deploy-what-if
- PSRule for Azure: https://azure.github.io/PSRule.Rules.Azure/
- PSRule for Azure changelog: https://azure.github.io/PSRule.Rules.Azure/changelog/
- ARM-TTK: https://github.com/Azure/arm-ttk
- hadolint: https://github.com/hadolint/hadolint
- container-structure-test: https://github.com/GoogleContainerTools/container-structure-test
- Docker Scout: https://docs.docker.com/scout/
- Grype: https://github.com/anchore/grype
- kubeconform: https://github.com/yannh/kubeconform
- kube-linter: https://github.com/stackrox/kube-linter
- Polaris: https://www.fairwinds.com/polaris
- Chainsaw: https://kyverno.github.io/chainsaw/
- Chainsaw kuttl migration: https://kyverno.github.io/chainsaw/main/guides/kuttl-migration/
- kudobuilder/kuttl: https://github.com/kudobuilder/kuttl
- actionlint: https://github.com/rhysd/actionlint
- zizmor: https://docs.zizmor.sh/
- act: https://github.com/nektos/act
- pre-commit: https://pre-commit.com/
- Pester: https://pester.dev/
- Chaos Mesh: https://chaos-mesh.org/, Litmus: https://litmuschaos.io/

Verified: 2026-10-14. Confirmed via web: terraform test/mocking capability levels (1.6/1.7) and syntax from HashiCorp docs; Checkov maintenance (Prisma Cloud) and frameworks from README; KICS current version 2.1.15 from docs.kics.io; Trivy as tfsec successor and IaC+image coverage from integration articles; ARM-TTK still releasing (latest 2026-02) with the official note that Bicep contains all deploymentTemplate tests since 0.10 and new tests move to the Bicep linter; kudobuilder/kuttl active again (v0.27.0, Sep 2026) with the kyverno kuttl fork ARCHIVED status and Chainsaw as the Kyverno-recommended replacement with kuttl-migration commands; PSRule for Azure current version 1.47.0 (tagged Jan 2026) with dated baselines and v2 rename notes; Bicep linter levels (Error/Warning/Info/Off in bicepconfig.json), what-if change types and --validation-level/--confirm-with-what-if switches, and `bicep snapshot` from Microsoft Learn; hadolint v2.15.x releases; container-structure-test 1.22.x and its maintenance-mode statement; LHCI and others not in this file. Infracost PR workflow shape from official docs. Terraform BSL/OpenTofu split: from memory (widely documented 2023); tflint/Terratest/actionlint/act/kubeconform/kube-linter/Polaris/Conftest/Chaos Mesh/Litmus maintenance: from memory, all active as of training data, no version numbers asserted; pre-commit-terraform rev example: illustrative, check latest tag.