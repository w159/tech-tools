# Frontend States

Every data-driven surface this skill touches handles all four states
before the work is called done. A screen that handles only the happy
path is incomplete. The states are non-negotiable because each one
is a real user condition that occurs on every async surface.

## The four states

### Loading

- Skeleton mirrors the real content layout. No spinners in content
  areas. No layout shift when the content arrives.
- Skeleton must match the real content dimensions within 5%. A
  skeleton for a 3-row table has 3 skeleton rows.
- Never show a skeleton for longer than 5 seconds. If loading
  exceeds 5 seconds, transition to the extended-progress pattern.
- For instant operations (<300ms), skip the skeleton. Optimistic
  UI with a toast is the right pattern.

### Empty

- Contextual message plus an actionable CTA. Not "No data found."
- Distinguish first-run empty (user has never had data) from
  filtered-empty (user filtered out all data). Each gets its own
  message.
- The CTA advances the user's goal. "Create your first project" not
  "OK."

### Error

- Human-readable message plus a retry action plus an error reference
  code.
- Never raw stack trace in the UI. Never just "Error."
- The retry action re-issues the failed request. It does not reload
  the page.
- The error reference code maps to a log line the operator can find.

### Success

- Inline confirmation for small scopes, toast for medium, progress
  modal for large.
- Optimistic updates for instant operations (<300ms). Roll back on
  failure.
- Success state is visible long enough to read, then dismissed. A
  toast that vanishes in 800ms is a defect.

## Accessibility (WCAG 2.1 AA)

These are mandatory, not aspirational.

- Color contrast: 4.5:1 for text, 3:1 for large text and UI
  components.
- Keyboard reachable. Every interactive element is reachable in
  logical tab order. No mouse-only interactions.
- Focus ring visible. `ring-2 ring-ring ring-offset-2`. Never remove
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
- Breakpoints: sm 640, md 768, lg 1024, xl 1280, 2xl 1536.
- No horizontal scroll on any viewport 320px or wider.
- Test at mobile width in the browser, not just in the story.

## Motion

- All animation serves a purpose: guide attention, communicate state
  change, or maintain spatial context. Decorative animation is a
  defect.
- Modal enter: fadeIn plus translateY(8px to 0), 220ms, ease-out.
- Modal exit: fadeOut plus translateY(0 to 6px), 160ms, ease-in.
- Step complete: crossfade from spinner to checkmark, 200ms.
- Progress bar: width transition 400ms ease-in-out.
- Suppress all motion when `prefers-reduced-motion: reduce` is
  active. No animation exceeds 500ms unless it is a continuous
  indicator.

## Design system discipline

- One design system per project. Default: shadcn/ui plus Tailwind
  plus Radix. Do not mix in MUI, Bootstrap, or Chakra.
- Central tokens for color, spacing, typography. No magic values
  scattered in components. `text-foreground`, `bg-primary`,
  `border-border`, not `text-[#3a7fc2]`.
- `components/ui/` is the shadcn directory. Do not modify those files
  directly. Wrap and extend.
- Brand colors come from the project token file, never hardcoded.

## Verify in the browser

- Visit each route after hot reload. Confirm the console is clean.
- Reach and show all four states on each data-driven surface. Capture
  the route and the state.
- Confirm responsive layout at mobile width.
- Confirm keyboard navigation reaches every interactive element.

A report that claims "all states handled" without the routes and
state captures is a claim, not evidence. The verifier will refuse it.