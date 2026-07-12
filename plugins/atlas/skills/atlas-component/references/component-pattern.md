# Component Pattern

The contract every component this skill creates or modifies follows.
The pattern is strict because components are composed hundreds of
times across a codebase. A component that breaks one rule here breaks
every screen that uses it.

## Props interface

- Always explicitly typed and exported. `interface ComponentProps
  extends React.ComponentProps<typeof Root>`.
- Every prop is named for what it IS, not how it is used. emailAddress
  not email; maxLoginAttempts not max.
- Booleans read as questions: isAuthenticated, hasPermission,
  shouldRetry, canEdit.
- Collections are plural, items are singular. users is an array; user
  is one element.
- Optional props have a sensible default. The component must render
  correctly with no props passed.
- No `any`. No untyped parameters. No implicit null. Make illegal
  states unrepresentable through discriminated unions and required
  fields.

## className via cn()

- `className` is always accepted and merged via the project's `cn()`
  helper, never string-concatenated.
- Remaining props are spread to the root element. Never pick and
  choose which DOM props to forward.
- The component's own classes are stable; the caller's `className`
  is appended, not replaced.

## The six interaction states

Every interactive element defines all six. Missing one is a defect.

| State | Treatment |
|---|---|
| Default | Base styling. |
| Hover | Subtle background shift or shadow increase. Never change layout. |
| Focus | Visible ring: `ring-2 ring-ring ring-offset-2`. Obvious for keyboard users. |
| Active | Slight scale `active:scale-[0.98]` or darkened background. |
| Disabled | `opacity-50`, `cursor-not-allowed`. No hover effects. |
| Loading | Replace content with spinner. Maintain element dimensions. |

For data-driven components, also handle the four data states: idle,
in-flight, success, error. A component that renders only the success
state is incomplete.

## Backend resilience

For components that call a backend (progress modal, upload widget,
job panel), each backend behavior gets an explicit visual state.

- Slow response: skeleton or spinner. Never a frozen screen.
- Mid-flight cancellation: the cancel button is never hidden, only
  disabled while the cancellation is in flight. On 5s timeout with no
  backend ack, show an error and re-enable cancel.
- Partial failure: each failed item gets its own error indicator,
  not one global error for the batch.
- Success: visible long enough to read, then dismissed.

Cancellation contract:
1. User clicks Cancel.
2. `onCancel()` fires.
3. `isCancelling = true` (disables button, shows spinner).
4. Caller sends the cancellation signal.
5. Backend emits CancellationAckEvent.
6. Modal unmounts.
7. On 5s timeout: show error, re-enable Cancel.

The modal never self-closes. It defers to the caller via `onCancel`.

## Accessibility

- Focus management: when the component opens (modal, dropdown,
  popover), focus moves to the first interactive element inside it.
  On close, focus restores to the trigger.
- ARIA roles and labels: `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby`, `aria-describedby` for modals. `aria-label` for
  icon-only buttons.
- Keyboard escape: Escape closes modals and dropdowns. Tab order is
  logical. Focus is trapped inside modals while open.
- Reduced motion: all animation suppressed when
  `prefers-reduced-motion: reduce` is active.

## File pattern

Every component file follows this shape:

```tsx
// COMPONENT: StatCard
interface StatCardProps extends React.ComponentProps<typeof Card> {
  title: string;
  value: string | number;
}

function StatCard({ title, value, className, ...props }: StatCardProps) {
  return (
    <Card className={cn("transition-shadow hover:shadow-md", className)} {...props}>
      ...
    </Card>
  );
}

export { StatCard };
export type { StatCardProps };
```

Rules the pattern encodes:

- Props interface always explicitly typed and exported.
- `className` always accepted and merged via `cn()`.
- Remaining props always spread to the root element.
- Section comments at logical breakpoints.

## Component file location

- atoms/ for stateless pure UI: Button, Badge, Icon.
- molecules/ for composed atoms: FormField, SearchInput, StatCard.
- organisms/ for complex sections with local state: DataTable, Modal,
  SideNav.
- templates/ for page scaffolding.
- pages/ for route-level components. Only data fetching happens here.
- `components/ui/` is the shadcn directory. Do not modify directly.
  Wrap and extend.

## What this pattern is not

- Not a god component. A component that takes 30 props to handle
  every case is two components. Split it.
- Not a leaky abstraction. The component does not expose its internal
  state through props. It exposes behavior, not implementation.
- Not a styling free-for-all. The project token file is the only
  source of colors, spacing, and typography. No hardcoded values.

## Verify

- Render each state in a harness or story: idle, in-flight, success,
  cancelled, error, partial. Show how each was triggered.
- Exercise one failure path live (slow or failing backend) and
  confirm the component holds its defined state.
- Confirm keyboard and reduced-motion behavior.