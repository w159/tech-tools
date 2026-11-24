# Frontend States

## Contents

- [The four states](#the-four-states)
- [Accessibility (WCAG 2.1 AA)](#accessibility-wcag-21-aa)
- [Responsive](#responsive)
- [Motion](#motion)
- [Design system discipline](#design-system-discipline)
- [Verify in the browser](#verify-in-the-browser)

Every data-driven surface this skill touches handles all four states
before the work is called done. A screen that handles only the happy
path is incomplete. The states are non-negotiable because each one
is a real user condition that occurs on every async surface.

## The four states

### Loading

- Use the loading pattern recorded in the project's design system
  (skeleton, spinner, or other). No layout shift when the content
  arrives.
- A placeholder must match the real content dimensions within 5%.
- Never show a skeleton for longer than 5 seconds. If loading
  exceeds 5 seconds, transition to the extended-progress pattern.
- For instant operations (<300ms), skip the skeleton. Optimistic
  UI with a toast is the right pattern.

### Empty

- Contextual message plus an actionable CTA. Wording follows the
  project's copy tone.
- Distinguish first-run empty (user has never had data) from
  filtered-empty (user filtered out all data). Each gets its own
  message.
- The CTA advances the user's goal and is worded per the project's
  copy tone.

### Error

- Human-readable message plus a retry action plus an error reference
  code, worded per the project's copy tone.
- Never raw stack trace in the UI. Never a bare "Error" with no
  explanation.
- The retry action re-issues the failed request. It does not reload
  the page.
- The error reference code maps to a log line the operator can find.

### Success

- Inline confirmation for small scopes, toast for medium, progress
  modal for large.
- Optimistic updates for instant operations (<300ms). Roll back on
  failure.
- Success state is visible long enough to read, then dismissed. A
  toast that vanishes before it can be read is a defect; use the
  project's toast duration.

## Accessibility (WCAG 2.1 AA)

These are mandatory, not aspirational.

- Color contrast: 4.5:1 for text, 3:1 for large text and UI
  components.
- Keyboard reachable. Every interactive element is reachable in
  logical tab order. No mouse-only interactions.
- Focus ring visible, styled with the project's focus-ring token
  (for example `var(--focus-ring)`). Never remove
  the focus outline without replacing it.
- Accessible name on every interactive element. `aria-label` or
  `aria-labelledby` when the visible text is not sufficient.
- Form errors announced to screen readers. `aria-describedby` plus
  `aria-invalid` on the field. Error text lives in a `FormMessage`,
  not a toast.
- Page has one `h1` and a logical heading hierarchy. No heading
  levels skipped.
- Touch targets minimum 44x44px (WCAG 2.5.5).
- Modal pattern: `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby`, `aria-describedby`. Focus is trapped while open
  and restored to the trigger on close.

## Responsive

- Mobile-first. Design at 320px first, then widen.
- Breakpoints come from the project's breakpoint tokens in
  `docs/standards/design-system.md`.
- No horizontal scroll on any viewport 320px or wider.
- Test at mobile width in the browser, not just in the story.

## Motion

- All animation serves a purpose: guide attention, communicate state
  change, or maintain spatial context. Decorative animation is a
  defect.
- Distance, duration and easing for every transition (modal enter
  and exit, step complete, progress bar) come from the project's
  motion tokens (for example `var(--motion-duration)`,
  `var(--motion-easing)`).
- Suppress all motion when `prefers-reduced-motion: reduce` is
  active.

## Design system discipline

- One design system per project, the one in `docs/standards/design-system.md`.
  Do not add a second component or icon library without asking.
- Central tokens for color, spacing, typography. No magic values
  scattered in components. Use the project's token names, not raw hex.
- Vendored primitive directories (for example a generated `components/ui/`)
  are not edited directly. Wrap and extend.
- Brand colors come from the project token file, never hardcoded.

## Verify in the browser

- Visit each route after hot reload. Confirm the console is clean.
- Reach and show all four states on each data-driven surface. Capture
  the route and the state.
- Confirm responsive layout at mobile width.
- Confirm keyboard navigation reaches every interactive element.

A report that claims "all states handled" without the routes and
state captures is a claim, not evidence. The verifier will refuse it.