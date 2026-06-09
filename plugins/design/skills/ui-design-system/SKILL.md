---
name: ui-design-system
description: Modernize frontend codebases into production-grade interfaces using shadcn/ui, Tailwind CSS, and Radix UI. Covers design tokens, component architecture, loading/progress feedback patterns, accessibility, dark mode, and responsive design. Trigger with "modernize the UI", "ui refactor", "migrate to shadcn", "fix the design system", "add loading states", "progress feedback", "make it look modern", or when someone needs help with frontend component architecture, design tokens, or async feedback patterns.
---

# Frontend UI/UX Design System

A complete methodology for building and refactoring frontends into modern, consistent, accessible interfaces using shadcn/ui components, Tailwind CSS, and Radix UI primitives.

## 1. Design Philosophy

### Core Principles

- **Consistency Is Trust**: Every element behaves predictably. Same actions produce same patterns. Same feedback for same operations. Same spacing, typography, interaction model — everywhere.
- **Clarity Over Cleverness**: The user never guesses what something does, where they are, or what happened. Every screen answers: "Where am I?", "What can I do?", "What just happened?"
- **Progressive Disclosure**: Show only what's needed. Use collapsible sections, tabs, drawers, and multi-step flows to manage density.
- **Feedback Is Mandatory**: Every user action produces immediate, visible feedback. Every click, submit, navigation, async operation. If the system is thinking, the user knows. Succeeded? They know. Failed? They know what went wrong and what to do.
- **Accessibility Is Non-Negotiable**: WCAG 2.1 AA minimum. Keyboard navigation, screen reader support, ARIA labels, color contrast, focus management, reduced-motion support.
- **Mobile-First, Responsive Always**: Design for 320px first, enhance upward. Functional and attractive from 320px to 2560px.
- **Performance Is a Feature**: Lazy-load heavy components, code-split routes, optimize images. Skeletons > spinners (they communicate structure). Perceived performance matters as much as actual.

### Material Design Alignment (Without Material Dependency)

Apply these principles using shadcn/ui + Tailwind only — no Material UI imports:

- **Elevation & Depth**: Consistent shadow scales for hierarchy. Cards float above page, modals above cards, dropdowns above everything. Use `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl` deliberately.
- **Motion with Purpose**: Every animation guides attention, communicates state change, or maintains spatial context. No decorative animations.
- **Surface Hierarchy**: Background colors, borders, and shadows clearly distinguish content layers.
- **Intentional Density**: Data-dense screens use compact spacing. Forms use comfortable spacing. Never mix density modes in the same context.

## 2. Design Token System

All visual values flow from a centralized token system using CSS custom properties. Zero arbitrary values.

### Color Tokens (shadcn/ui theming)

```css
:root {
  /* Core surfaces */
  --background: ;        /* Page background */
  --foreground: ;        /* Primary text */
  --card: ;              /* Card/container surface */
  --card-foreground: ;

  /* Interactive */
  --primary: ;           /* Main CTAs, active nav, links */
  --primary-foreground: ;
  --secondary: ;         /* Supporting actions */
  --secondary-foreground: ;
  --accent: ;            /* Hover highlights, selected states */
  --accent-foreground: ;

  /* Subdued */
  --muted: ;             /* Grouped content backgrounds, disabled */
  --muted-foreground: ;  /* Secondary text */

  /* Feedback */
  --destructive: ;       /* Errors, delete actions — never decorative */
  --destructive-foreground: ;

  /* Semantic extensions */
  --success: ;           --success-foreground: ;
  --warning: ;           --warning-foreground: ;
  --info: ;              --info-foreground: ;

  /* System */
  --border: ;            --input: ;             --ring: ;
  --radius: 0.625rem;

  /* Animation durations */
  --duration-fast: 100ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;
  --duration-slower: 500ms;
}
```

### Rules

- **Zero arbitrary values**: No `text-[13px]`, `p-[7px]`, `bg-[#3a7fc2]`. If the scale doesn't have it, adjust the design.
- **Theme-aware colors only**: Use `text-foreground`, `bg-primary`, `border-border`. Never raw Tailwind colors like `text-gray-500` — these break dark mode.
- **Consistent spacing increments**: Pick 4px or 8px base. If you need `p-3` and `p-5` in the same context, something is misaligned.

## 3. Application Shell

Every page lives inside a consistent shell:

```
┌──────────────────────────────────────────────────────┐
│  Top Bar: Logo | Breadcrumb trail | Global actions   │
├───────────┬──────────────────────────────────────────┤
│           │  Main Content Area                       │
│  Sidebar  │  ┌────────────────────────────────────┐  │
│  (nav +   │  │ Page Header: Title + Actions       │  │
│  context) │  ├────────────────────────────────────┤  │
│           │  │ Page Content                       │  │
│           │  └────────────────────────────────────┘  │
├───────────┴──────────────────────────────────────────┤
│  Status Bar (optional): Connection, sync status      │
└──────────────────────────────────────────────────────┘
```

- **Sidebar**: shadcn/ui `Sidebar`, collapsible, drawer on mobile, fixed on desktop
- **Breadcrumbs**: On every page, generated from route structure — never hardcoded
- **NavigationMenu**: For <6 top-level sections; otherwise use Sidebar
- **Page headers**: Title left, primary actions right — consistent everywhere
- **Deep linking**: Every view has a unique URL. Tabs, filters, pagination, modal state — all in URL

## 4. Component Architecture

### Atomic Design Layers

```
components/
├── ui/              # shadcn/ui primitives (rarely edited)
├── atoms/           # StatusDot, CurrencyDisplay, Timestamp
├── molecules/       # SearchInput, UserBadge, StatCard
├── organisms/       # DataTable, FilterPanel, ActivityFeed
├── templates/       # DashboardLayout, FormPageLayout
└── feedback/        # Progress, loading, and status components
```

### Component Rules

- Before building custom, verify no shadcn/ui component or composition works
- When extending shadcn/ui, wrap it — don't fork. Maintain upgrade compatibility
- Always use `cn()` for conditional class merging
- Always forward refs and spread remaining props
- `className` always accepted and merged
- JSDoc on every prop
- Section comments delineate types, component logic, exports
- No inline styles — Tailwind only, theme tokens only
- Export both the component and its props type

## 5. Visual Consistency

### Typography

- Strict type scale: `text-xs` through `text-4xl` — never deviate
- Headings: `font-semibold` or `font-bold`. Body: `font-normal`. Labels: `font-medium`
- `text-foreground` for primary, `text-muted-foreground` for secondary, `text-destructive` for errors

### Iconography

- One library everywhere: Lucide React (included with shadcn/ui)
- Consistent sizing per context: 16px compact/inline, 20px standard, 24px prominent
- Icons alone must have `aria-label` or `sr-only` text
- Never mix icon libraries

### Interaction States

Every interactive element must have all six states:

| State | Treatment |
|-------|-----------|
| Default | Base styling |
| Hover | Subtle background shift or shadow. Never change layout |
| Focus | Visible ring: `ring-2 ring-ring ring-offset-2` |
| Active/Pressed | Slight scale `active:scale-[0.98]` or darkened background |
| Disabled | `opacity-50`, `cursor-not-allowed`, no hover |
| Loading | Replace content with spinner or skeleton. Maintain dimensions |

## 6. Progress Feedback System

**Users must never stare at a frozen screen.** Every non-instant operation communicates progress.

### Three Feedback Tiers

| Tier | Latency | Pattern |
|------|---------|---------|
| Tier 1: Instant | < 300ms | Optimistic UI + toast confirmation |
| Tier 2: Brief | 300ms – 3s | Button loading state, skeletons, inline progress |
| Tier 3: Extended | > 3s | Full progress modal with step detail and ETA |

### Tier 1: Instant (< 300ms)

For toggles, simple saves, navigation:

- **Optimistic updates**: Change UI immediately, rollback on failure
- **Toast confirmation**: `Sonner` — success auto-dismisses in 3s, errors persist with retry action
- **Micro-animation**: Button checkmark, smooth toggle, card animate into list

### Tier 2: Brief (300ms – 3s)

For API fetches, form submissions, small uploads:

**Button loading state**:
- Width must not change between states (use `min-w-*`)
- Text describes the action: "Save" → "Saving…", "Delete" → "Deleting…"
- Spinner replaces icon, not text
- All other inputs disabled during submission

**Skeleton loading**:
- Layout exactly matches real content dimensions — no layout shift on load
- Shapes match content type: circles for avatars, bars for text, rectangles for images
- If loading exceeds 5s, transition to Tier 3

**Inline progress**: For determinate operations like file uploads — show percentage and progress bar.

### Tier 3: Extended (> 3s)

For bulk processing, report generation, multi-step workflows, AI operations, imports/exports.

The progress modal must communicate:
1. **What** is happening — operation name and description
2. **Where** we are — current step
3. **How far** — percentage or step count
4. **What's done** — checkmarks on finished steps
5. **What's remaining** — visible upcoming steps
6. **How long** — estimated time remaining
7. **What went wrong** — inline error per step with retry

Build this as a reusable `OperationProgressModal` component with a `useOperationProgress` hook. See the command reference for full implementation patterns.

### Feedback Decision Matrix

| Operation | Latency | Pattern |
|-----------|---------|---------|
| Toggle, checkbox, switch | Instant | Optimistic + toast |
| Save form (few fields) | < 1s | Button loading + toast |
| Save form (large) | 1–3s | Button loading + inline progress |
| Page navigation | < 500ms | Route transition skeleton |
| Data table load | 1–3s | Full table skeleton |
| Search / filter | 300ms–2s | Debounce + inline skeleton |
| File upload (small) | 1–5s | Inline progress bar |
| File upload (large) | 5s–5m | Progress modal with speed/ETA |
| Report generation | 3s–60s | Progress modal with steps |
| Bulk import/export | 5s–10m | Progress modal with steps + row count |
| AI / ML processing | 5s–5m | Progress modal with activity log |
| Multi-service orchestration | 3s–60s | Progress modal per-service status |
| Background job (fire & forget) | N/A | Toast with "View progress" link |

## 7. Error States & Empty States

### Error Boundaries

Every major UI section wrapped in an error boundary that:
- Catches rendering errors without crashing the app
- Shows contextual error with retry option
- Logs error with full context
- Uses shadcn/ui `Alert` with `variant="destructive"`

### Empty States

Every data-driven view has a designed empty state:
- Explains why (no data yet vs. no results match filters)
- Provides clear CTA ("Import first transactions", "Clear filters")
- Consistent pattern: centered icon + heading + description + action button
- Visually distinct from loading (no skeletons for empty)

### Form Validation

- shadcn/ui `Form` + `react-hook-form` + `zod` schema validation
- Validate on blur per field, on submit for form
- Errors below the field via `FormMessage` in `text-destructive`
- Never use toasts for field-level validation
- Disable submit until form is dirty; show validation on submit attempt

## 8. Animation Standards

### Categories

| Purpose | Duration | Easing |
|---------|----------|--------|
| State feedback (hover, focus) | 100–150ms | `ease-in-out` |
| Reveal content (accordion, dropdown) | 150–250ms | `ease-out` |
| Navigate (page, tab, drawer) | 200–350ms | `ease-in-out` |
| Attract attention (notification, error) | 300–600ms | `ease-out` or spring |
| Progress (spinner, progress bar) | Continuous | `linear` |

### Rules

- Respect `prefers-reduced-motion` — wrap or conditionally apply all animations
- No animation > 500ms except continuous indicators
- Entry: `ease-out`. Exit: `ease-in`
- Content shifting always animated — never let layout snap

## 9. Dark Mode & Theming

- Support light and dark via shadcn/ui theme system
- All colors reference CSS custom properties — never raw Tailwind colors
- Instant switching with no FOUC — use `next-themes` with `class` strategy
- Test every component and state in both themes
- Shadows, borders, background layers often need dark mode adjustment

## 10. Refactoring Process

1. **Audit** — catalog components, screenshot current state
2. **Install shadcn/ui** — Tailwind, CSS variables, `cn()`, token system
3. **Build application shell** — sidebar, nav, breadcrumbs
4. **Create feedback components** — progress modal, toasts, skeletons
5. **Migrate page by page** — verify all states after each
6. **Consolidate duplication** — shared components in atomic layers
7. **Add animations** — purposeful, under 500ms, motion-safe
8. **Dark mode pass** — verify every page
9. **Accessibility audit** — axe-core, keyboard nav, screen reader
10. **Final validation** — visual regression, responsive, Lighthouse ≥ 90

## 11. Deliverables Checklist

- [ ] All components built on shadcn/ui primitives
- [ ] Design tokens in CSS custom properties; zero arbitrary values
- [ ] Consistent navigation, breadcrumbs, page header on every page
- [ ] Atomic design: atoms → molecules → organisms → templates
- [ ] Every interactive element has 6 states: default, hover, focus, active, disabled, loading
- [ ] Every async operation has feedback per decision matrix
- [ ] Operations > 3s use progress modal with steps and ETA
- [ ] No silent loading anywhere
- [ ] Empty states and error states for every data-driven view
- [ ] Form validation: `react-hook-form` + `zod` + inline errors
- [ ] Animations purposeful, respect `prefers-reduced-motion`, under 500ms
- [ ] Dark mode flawless, no raw color values
- [ ] WCAG 2.1 AA verified (automated + manual)
- [ ] Responsive at 320px, 768px, 1024px, 1440px, 2560px
- [ ] Lighthouse ≥ 90
- [ ] Naming follows codebase-organization standards
- [ ] Section comments in every component file
