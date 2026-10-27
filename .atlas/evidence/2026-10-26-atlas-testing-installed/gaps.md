# gaps

| Area | Type | Status | Priority | Reason | Reference |
|---|---|---|---|---|---|
| ci | ci-pipeline | missing | must | tests only protect code when they run on changes | references/infra-iac-containers-ci.md |
| python | static-lint | missing | must | lint catches defect classes before tests run | references/types-functional.md |
| python | unit | present | must | fast isolation of logic defects | references/types-functional.md |
| security | sca | missing | must | third-party dependencies carry most known CVEs | references/types-security.md |
| security | secrets | missing | must | committed credentials are a top incident source | references/types-security.md |
| shell | static-lint | missing | must | lint catches defect classes before tests run | references/types-functional.md |
| shell | unit | missing | must | fast isolation of logic defects | references/types-functional.md |
| python | coverage | missing | should | measures which behavior tests actually exercise | references/types-test-quality.md |
| python | fuzz | missing | should | random inputs find crashes and unhandled errors | references/types-input-generation.md |
| python | integration | missing | should | verifies modules work together against real seams | references/types-functional.md |
| python | mutation | missing | should | checks test strength by mutating code under test | references/types-mutation.md |
| python | type-check | missing | should | type errors surface without executing code | references/types-functional.md |
| security | sast | missing | should | static security analysis of first-party code | references/types-security.md |
| shell | coverage | missing | should | measures which behavior tests actually exercise | references/types-test-quality.md |
| shell | integration | missing | should | verifies modules work together against real seams | references/types-functional.md |
| shell | mutation | missing | should | checks test strength by mutating code under test | references/types-mutation.md |
| shell | type-check | missing | should | type errors surface without executing code | references/types-functional.md |
| python | benchmark | missing | could | guards performance regressions | references/types-nonfunctional.md |
| python | property-based | missing | could | generates inputs beyond hand-picked examples | references/types-input-generation.md |
| shell | benchmark | missing | could | guards performance regressions | references/types-nonfunctional.md |
| shell | fuzz | missing | could | random inputs find crashes and unhandled errors | references/types-input-generation.md |
| shell | property-based | missing | could | generates inputs beyond hand-picked examples | references/types-input-generation.md |
