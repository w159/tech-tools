// COMPONENT: ComponentName
//
// Seed skeleton. Copy this file, rename ComponentName, and implement.
// Follow references/component-pattern.md for the full contract.
//
// Layer: use the project's component layering (docs/standards/design-system.md).
// Every <project ...> marker below is a slot: fill it from the project's
// design-system.md and token file, or ask the user. Do not invent values.

// <project styling helper>: import the project's class-merge or style helper
// here if it has one; otherwise remove this line.
// <project component library>: import a primitive here only if the project
// records one in design-system.md.

// Props interface: explicitly typed and exported. Name each prop for
// what it IS (emailAddress, maxLoginAttempts), not how it is used.
export interface ComponentNameProps
  extends React.ComponentProps<"div"> {
  // Required props first, then optional with defaults.
  title: string;
  value?: string | number;
}

function ComponentName({
  title,
  value,
  className,
  ...props
}: ComponentNameProps) {
  // Styling comes from the project's token file and styling approach.
  // Example shape: className="<project surface class>" backed by tokens such
  // as var(--surface), var(--border), var(--space-md), var(--radius-md).
  const baseClassName = "<project surface class>";
  // Define all six interaction states (default, hover, focus, active,
  // disabled, loading) from the project's tokens: its hover treatment, its
  // focus-ring token (e.g. var(--focus-ring)), its pressed treatment, its
  // disabled treatment. Focus must stay visible and keyboard reachable, and
  // motion must honor prefers-reduced-motion.
  const stateClassName = "<project interaction-state classes>";

  return (
    <div
      // Caller className is appended, never replaced.
      className={[baseClassName, stateClassName, className]
        .filter(Boolean)
        .join(" ")}
      aria-label={title}
      {...props}
    >
      {/* Content here. Render all four data states (loading, empty, */}
      {/* error, success) if this component fetches data. */}
      {/* Type styles: use the project's typography tokens, e.g. var(--text-heading). */}
      <h3 className="<project heading class>">{title}</h3>
      {value !== undefined && (
        <p className="<project value class>">{value}</p>
      )}
    </div>
  );
}

export { ComponentName };
