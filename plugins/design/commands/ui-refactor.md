---
description: Modernize a frontend codebase into a consistent shadcn/ui design system with proper feedback patterns
argument-hint: "<path to frontend or specific area to focus on>"
---

# /ui-refactor

> Audit and modernize a frontend into a production-grade interface built on shadcn/ui, Tailwind CSS, and Radix UI primitives. See the **ui-design-system** skill for the full methodology, component standards, and feedback patterns.

## Usage

```
/ui-refactor $ARGUMENTS
```

Modernize the frontend at: @$1

If no argument is provided, analyze the current working directory for frontend code.

If a specific path is given (e.g., `frontend/src/features/auth`), scope the refactoring to that area while respecting the project-wide design system.

## Workflow

### Phase 1: Audit (read-only - no changes yet)

Before changing anything, catalog the current frontend state:

1. **Component inventory** - list every component, page, and reusable pattern
2. **Design inconsistencies** - spacing, colors, typography, interaction states that vary
3. **Duplicated UI patterns** - components that do the same thing in different ways
4. **Non-standard elements** - custom components where shadcn/ui equivalents exist
5. **Loading/feedback gaps** - async operations without visible feedback, silent failures
6. **Empty state gaps** - data-driven views with no designed empty state
7. **Accessibility issues** - missing ARIA labels, keyboard traps, contrast violations
8. **Arbitrary values** - hardcoded colors, magic pixel values, raw Tailwind colors instead of tokens
9. **Dark mode readiness** - raw color values that would break theming

Present findings as a structured report with severity before proceeding.

### Phase 2: Plan

Based on audit, produce a sequenced migration plan:

1. Install and configure shadcn/ui + design token system
2. Build the application shell (sidebar, nav, breadcrumbs, page header pattern)
3. Create feedback infrastructure (progress modal, toast patterns, skeleton variants)
4. Migrate page by page - replace components with shadcn/ui equivalents
5. Consolidate duplicated UI patterns into shared atomic components
6. Add animations and transitions (purposeful, under 500ms, motion-safe)
7. Dark mode pass - verify every page
8. Accessibility audit - axe-core + keyboard navigation + screen reader
9. Final validation - visual regression, responsive test, Lighthouse >= 90

**Present the plan for approval before executing.**

### Phase 3: Execute

Work through the plan:

- After each page migration, verify: visual consistency, all 6 interaction states, loading states, error states, empty states
- Commit after each logical unit
- Screenshot before and after for regression comparison
- Never assume what a component does - read it first, preserve functionality

### Phase 4: Validate

Run the full deliverables checklist from the ui-design-system skill:

- All components built on shadcn/ui primitives
- Zero arbitrary Tailwind values
- Every async operation has feedback per the decision matrix
- Operations >3s use progress modal with step detail
- WCAG 2.1 AA verified
- Responsive at 320px, 768px, 1024px, 1440px, 2560px
- Dark mode flawless
- Lighthouse >= 90

## Output Modes

### Full refactor (default)
Complete audit -> plan -> execute -> validate cycle.

### Audit only
```
/ui-refactor audit
```
Findings report without changes.

### Plan only
```
/ui-refactor plan
```
Audit + plan, no execution.

### Component inventory
```
/ui-refactor inventory
```
Catalog every component with its shadcn/ui equivalent (or "custom - no equivalent").

## If Connectors Available

If **~~design tool** is connected:
- Pull design tokens, component specs, and measurements from Figma
- Verify implementation matches design files
- Extract color palette and typography scale for the token system

If **~~project tracker** is connected:
- Create subtasks for each migration phase
- Track per-page migration progress

If **~~knowledge base** is connected:
- Pull brand guidelines for color and typography decisions
- Reference existing design system documentation

## Tips

1. **Start with `audit`** - know what you're working with before committing.
2. **Build feedback components first** - the progress modal, skeletons, and toast patterns are used everywhere.
3. **Migrate one page at a time** - verify each before moving on.
4. **Pair with `/refactor`** - clean the code structure first, then modernize the UI.
5. **Pair with `/accessibility`** - run a deeper accessibility audit after migration.
