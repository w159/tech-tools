# Building the prototype

Required read before you write any prototype code, alongside `references/preview.md`.

## Fidelity

Fidelity is a different axis from size (`references/scoping.md` owns sizing, which the go-ahead depends on). Throwaway means unmaintained and unshipped, not thin - do not test, abstract, or harden past runnable, but take finish as far as the dimension under test needs. A flow or state model gets rich enough to drive; a visual direction gets finished enough to judge; a placement question stays thin. Fidelity may differ per avenue within one wide run. Do not stay low-fidelity on principle, and persist state only when persistence is the question.

Prototype code gets none of the product's engineering gates: no tests, no lint discipline, no abstraction for reuse, no error handling beyond what keeps the demo from breaking mid-reaction. It must be obvious to any later reader that this is throwaway - keep it inside the run directory (or the `prototype/<slug>` scratch branch) so the quarantine does the labeling.

## Substrate

Default substrate: the web, whatever the product is written in - a native app's navigation feel gets a web approximation, not SwiftUI.

Yield from the web default in exactly two cases: the user names a technology, or the dimension cannot be rendered in a browser without faking it. In that second case, build in the medium the dimension requires and name that choice before you build. If a named technology also cannot render the dimension, say so rather than yielding silently.

On the web path the artifact is whatever a browser can display and you can author - HTML, SVG, CSS renderings, images - served from the run directory. When markup cannot carry the dimension honestly (a photographic or painterly direction), report the missing capability instead of substituting markup that fakes the very thing being judged.

## Run root and containment

The run root is `.atlas/.run/prototypes/<YYYY-MM-DD>-<slug>/`. `.atlas/.run/` is already gitignored in an atlas-scaffolded repo; verify with `git -C <repo root> check-ignore -q .atlas/.run/`. If it is not covered, tell the user and get their agreement before appending the one ignore line (or before proceeding at all) - never modify `.gitignore` silently. Fallback root when the user declines, asks that nothing be left in the repo, the run is not in a git repository, or the path fails the checks: `/tmp/atlas-prototypes-<uid>/<YYYY-MM-DD>-<slug>/`, where survival is best-effort - do not promise it a lifetime.

Real-app runtime questions (density or chrome on an existing page, nav feel in the actual app) use the scratch-worktree mode from the containment boundary: a sibling worktree on `prototype/<slug>`. In-place overlay in the user's working tree only on their explicit ask, and overlay edits are written through an `atlas:implementer` dispatch so the product tree is touched only by an agent whose brief says exactly which files it may touch and that everything is reverted at the end.

The one clean exception to the capsule: an overlay run has no run directory and leaves no artifact. Say so when handing over.

## Recreate, do not rebuild the app

Recreate what this question needs from the current product. Do not stand up the full app unless the question is the whole-product feel.

## Layout of the run directory

```text
.atlas/.run/prototypes/<YYYY-MM-DD>-<slug>/
  decisions.md               # run capsule; not a plan (SKILL.md owns its content)
  01-<question-slug>/
    screens/
      001-<variant>.html
      img/<asset>.png        # any assets the screen references, at the paths it uses
    state/
  02-<question-slug>/        # only when the run covers a second related question
    screens/
    state/
```

Give each question in a multi-question run its own child directory. `--directory` in the preview always points at a question directory, never the run directory.

## Showing it

When the question is which option wins, put the options on one surface so they can be judged together - unless that surface would distort what is being judged: a scroll or transition gets a full-size run of its own rather than being nested in a small framed panel, and the comparison surface stays static.

After each user-facing action or variant change, show the relevant state so they can see what changed. Revise the screen the user names, in place - do not mint a new numbered `00N-*.html` per comment while the revision loop is running.

A run's output is a set of decisions. Converging on one direction that resolves the ambiguity is the best outcome, not a precondition for the run being complete.
