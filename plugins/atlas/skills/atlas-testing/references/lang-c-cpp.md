# C and C++ testing

Language-specific tooling for testing C and C++ code. For type definitions and procedures see `workflow.md`. Versions verified 2026-10-14 unless marked `[unverified]`.

## Contents

- At a glance
- Recommended default stack
- Config snippets
- Gotchas
- Sources

## At a glance

| TYPE ID | Tool (current version) | Install | Run | Notes |
| --- | --- | --- | --- | --- |
| static-lint | clang-tidy + cppcheck 2.22.0 | package manager / LLVM toolchain | `clang-tidy -p build file.cpp; cppcheck --enable=warning,style,performance src/` | clang-tidy needs compile_commands.json (CMAKE_EXPORT_COMPILE_COMMANDS). |
| type-check | compiler warnings + sanitizers as the strict surface | none | `gcc/clang -Wall -Wextra -Werror -Wpedantic` | C/C++ have no static type tool beyond the compiler; treat warning-as-error plus ASan as the type/UB gate. |
| unit | GoogleTest v1.18.0 (with GoogleMock) or Catch2 v3.16.1 or doctest v2.5.3 | CMake FetchContent / vcpkg | `ctest` (via CTest) or direct binary | GoogleTest 1.18+ requires C++17. doctest is single-header and fastest to compile; Catch2 v3 is a library, has matchers and benchmarks. |
| integration | CTest harness + process-level test binaries | none | `ctest --output-on-failure` | Add tests via `add_test`; CTest runs fixtures, parallelism `-j`, label filters `-L smoke`. |
| component | GoogleTest with fakes/stubs behind interfaces | none | `ctest` | No fixed tool; mock via GoogleMock (`EXPECT_CALL`) or hand-rolled fakes. |
| api | GoogleTest against the service's HTTP facade if any (httplib/cpp-httplib in tests) `[unverified lib]` | none | `ctest` | Most C/C++ services are exercised at integration layer instead; keep this row for embedded HTTP servers. |
| contract | n/a (no mature C/C++ Pact client; pact-c++ exists via FFI `[unverified]`) | n/a | n/a | Run consumer contracts in a wrapper language (Python/Go) against C++ providers. |
| e2e | language-agnostic | n/a | n/a | Drive running binaries with Python/TS tools. |
| smoke | CTest labels | none | `ctest -L smoke` | Tag suites with `set_tests_properties(... PROPERTIES LABELS smoke)`. |
| regression | full `ctest` run | none | `ctest -R full_suite` | Deterministic seeds; keep -j bounded by CPU. |
| acceptance-bdd | n/a first-class; Cornichon Gherkin-to-GTest generator exists `[unverified status]` | n/a | n/a | BDD usually done in a wrapper language. |
| snapshot-approval | n/a first-class; golden files via file-compare asserts | none | n/a | Write golden outputs and diff; keep in testdata/. |
| characterization | golden files + full suite | none | n/a | Pin legacy behavior before refactor. |
| property-based | rapidcheck (stable, low maintenance activity) | CMake subdirectory | link `rapidcheck` + GoogleTest adapter | `rc::check("prop", [](std::vector<int> v) { RC_ASSERT(...); })`; shrinking built in. |
| fuzz | libFuzzer (clang `-fsanitize=fuzzer`) and AFL++ `[unverified minor]` | LLVM / afl++ package | `clang++ -fsanitize=fuzzer,address fuzz_target.cpp; ./fuzz_target corpus/` | libFuzzer: coverage-guided, in-process; AFL++: robust, forkserver; run in dedicated CI job. |
| metamorphic | implement as libFuzzer/rapidcheck harnesses (transform, compare) | none | n/a | e.g. round-trip encode/decode invariant. |
| combinatorial | GoogleTest value-parameterized tests (`TEST_P`) | none | `ctest` | For large domains prefer rapidcheck. |
| differential | tests comparing implementations (old lib vs new) | none | n/a | Link both implementations, compare outputs. |
| model-based | n/a first-class | n/a | n/a | Emulate via rapidcheck stateful properties. |
| mutation | Mull 0.34.1 (LLVM-based, active 2026) | packages for Ubuntu/Debian/RHEL/macOS brew experimental | `mull-runner-22 ./test_binary` | Requires LLVM-matched toolchain; `-mutation-score-threshold` gate; incremental via git diff filter. |
| coverage | gcov+lcov (GCC) or llvm-cov (Clang) | gcov/lcov packages, llvm-tools | build with `--coverage` / `-fprofile-instr-generate -fcoverage-mapping`, then `lcov` / `llvm-profdata merge; llvm-cov show` | CMake: `-DCMAKE_CXX_FLAGS=--coverage` or Clang profile flags; branch coverage: `-fprofile-arcs -ftest-coverage` (GCC). |
| flakiness | sanitizers (ASan/TSan/UBSan/MSan) + valgrind 3.x `[unverified minor]` | compiler flags / valgrind package | `-fsanitize=address` or `-fsanitize=thread` builds; `valgrind --leak-check=full ./test` | TSan and valgrind do not mix with other sanitizers; run one config per CI lane. |
| benchmark | Google Benchmark 1.10.0 | CMake FetchContent | build + run bench binary | `BENCHMARK(BM)->Args(...)`; use `benchmark::DoNotOptimize`; compare with baseline JSON (`--benchmark_out=`). |
| load | language-agnostic (wrk, k6) | n/a | n/a | see `types-nonfunctional.md`. |
| chaos | n/a first-class | n/a | n/a | Fault inject at network layer (toxiproxy) in wrapper-language tests. |
| accessibility | n/a (no UI) | n/a | n/a | see `types-nonfunctional.md`. |
| visual-regression | n/a | n/a | n/a | see `types-nonfunctional.md`. |
| cross-browser | n/a | n/a | n/a | see `types-nonfunctional.md`. |
| i18n | n/a first-class; test gettext catalogs exist via file checks | none | `ctest` | Assert .mo files present and msgids match. |
| sast | clang-tidy (bugprone, security checks) + cppcheck; optionally CodeChecker UI `[unverified]` | clang-tidy | `clang-tidy --checks=cppcoreguidelines,bugprone,clang-analyzer-security` | clang analyzer security checks flag alloc/format issues. |
| sca | n/a first-class in-source; dependency scan via conan/OSV `[unverified]`; cross-ref `types-security.md` | n/a | n/a | Cross-ref `infra-iac-containers-ci.md` for containerized supply chain. |
| secrets | gitleaks (language-agnostic) | binary | `gitleaks detect --redact` | see `types-security.md`. |
| dast | language-agnostic | n/a | n/a | see `types-security.md`. |
| iac-policy | cross-ref `infra-iac-containers-ci.md` | n/a | n/a | |
| container-scan | cross-ref `infra-iac-containers-ci.md` | n/a | n/a | |
| authz | n/a (no standard authz frameworks in C/C++); test ACL logic in unit tables | none | `ctest` | |
| data-quality | cross-ref `data-sql-databases.md` (libpq-based integration tests) | n/a | n/a | |
| db-migration | verify SQL migrations in integration tests via psql container | none | `ctest` | Cross-ref `data-sql-databases.md`. |
| docs-examples | n/a (Doxygen snippets not executed by default; convert examples to tests) | n/a | n/a | Prefer examples that compile as tests. |
| notebook | n/a | n/a | n/a | see `docs-notebooks-web-assets.md`. |
| link-check | language-agnostic | n/a | n/a | see `docs-notebooks-web-assets.md`. |
| ci-pipeline | CMake presets + CTest in CI; sanitizers matrix lanes | presets in CMakePresets.json | `cmake --preset asan && ctest --preset asan` | One lane per sanitizer config; keep GCC and Clang lanes. |
| exploratory | human-led | n/a | n/a | see `types-functional.md`. |
| usability | human-led | n/a | n/a | see `types-functional.md`. |

## Recommended default stack

GoogleTest (1.18.x) with GoogleMock for unit and component tests, wired through CTest; clang-tidy + cppcheck as static gates; sanitizer matrix (ASan on PR, TSan/UBSan nightly, MSan on Clang-only projects) for memory/concurrency faults; libFuzzer nightly on parsers; Google Benchmark where performance matters; gcov/llvm-cov coverage reports; Mull on a nightly cadence for mutation scoring; rapidcheck where properties are cheap to state.

Why: GoogleTest is the de-facto standard (Chromium, LLVM), integrates with rapidcheck and GoogleMock, and CTest gives one entry point for everything including fixtures and labels. doctest is the low-compile-time alternative when build time dominates; keep it consistent within a project rather than mixing.

## Config snippets

CMake: GoogleTest via FetchContent plus a coverage/sanitizer-friendly test target:

```cmake
include(FetchContent)
FetchContent_Declare(googletest
  URL https://github.com/google/googletest/releases/download/v1.18.0/googletest-1.18.0.tar.gz)
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

enable_testing()
add_executable(parser_test parser_test.cpp)
target_link_libraries(parser_test PRIVATE GTest::gtest_main GTest::gmock parser)
add_test(NAME parser_test COMMAND parser_test)
set_tests_properties(parser_test PROPERTIES LABELS "unit;smoke")

# sanitizer lane (preset):
# -DCMAKE_C_FLAGS=-fsanitize=address,undefined -DCMAKE_CXX_FLAGS=-fsanitize=address,undefined
```

Fuzzer target (libFuzzer + ASan):

```cpp
#include <cstdint>
#include "parser.h"
extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
  try { Parser::parse(reinterpret_cast<const char*>(data), size); }
  catch (const UserError&) {}  // expected; anything else is a finding
  return 0;
}
```

```bash
clang++ -std=c++17 -fsanitize=fuzzer,address fuzz_parser.cpp parser.cpp -o fuzz_parser
mkdir corpus && ./fuzz_parser -max_total_time=600 corpus/
```

Mull and coverage:

```bash
cmake -DCMAKE_CXX_COMPILER=clang++ -DCMAKE_EXPORT_COMPILE_COMMANDS=ON ..
clang++ -fclang-ir-frontend ...  # use mull docs for exact plugin flags per LLVM version
mull-runner-22 --mutation-score-threshold 70 ./parser_test
# coverage (GCC):
cmake -DCMAKE_CXX_FLAGS="--coverage" .. && ctest && lcov --capture -d . -o cov.info
```

CTest invocation:

```bash
ctest --output-on-failure -j 4 -L unit
ctest -C Release -T Test
```

## Gotchas

- One sanitizer at a time per build lane; combining ASan+MSan or sanitizer+valgrind gives false results. Keep separate CMake presets per lane.
- libFuzzer runs in-process: a crash kills the whole run, so fuzz targets must never leak global state; wrap stateful code carefully. Store found inputs in the corpus dir and commit reproducers.
- Mull needs a toolchain exactly matched to a supported LLVM version (18 through 22 as of 0.28 to 0.31) and its own compiler plugin; budget setup time and pin the toolchain in CI images.
- GoogleTest 1.18+ requires C++17; older codebases may need to stay on 1.14.x. Do not mix GoogleTest major versions across test targets in one build.
- GoogleTest death tests (`EXPECT_DEATH`) spawn subprocesses: slow and unsupported under some sanitizers; use sparingly.
- clang-tidy without compile_commands.json (set CMAKE_EXPORT_COMPILE_COMMANDS=ON) misparses templates and reports noise.
- CTest parallelism is per-test: keep individual tests single-threaded and let CTest parallelize, or you oversubscribe runners.
- Golden-file tests must tolerate platform differences (line endings, float formatting); normalize before diffing.
- rapidcheck has seen little maintenance activity; it is stable but plan for occasional build fixes against newer compilers, and prefer the GoogleTest adapter it ships.

## Sources

- https://github.com/google/googletest/releases (v1.18.0, 2026-08-10, C++17) and https://google.github.io/googletest/
- https://github.com/catchorg/Catch2/releases (v3.16.1, 2026-10-08)
- https://github.com/doctest/doctest/releases (v2.5.3, 2026-07-06)
- https://github.com/mull-project/mull and https://mull-project.com (0.34.1 Sep 2026, LLVM 21/22)
- https://github.com/emil-e/rapidcheck
- https://llvm.org/docs/LibFuzzer.html, https://aflplus.plus
- https://clang.llvm.org/extra/clang-tidy/, https://cppcheck.sourceforge.io
- https://cmake.org/cmake/help/latest/manual/ctest.1.html
- https://github.com/google/benchmark
- https://valgrind.org

Verified: confirmed 2026-10-14 via web: GoogleTest v1.18.0 (C++17 baseline, no new features on 1.18.x branch), Catch2 v3.16.1, doctest v2.5.3, Mull active (0.34.1, LLVM 21/22 support) with mull-instrument tool, cppcheck 2.22.0 (SourceForge/cppcheck-opensource), Google Benchmark 1.10.0, rapidcheck repo present with low maintenance activity. From memory, flagged unverified: valgrind/AFL++ minor versions, CodeChecker/conan status, Cornichon viability, pact-c++ existence.