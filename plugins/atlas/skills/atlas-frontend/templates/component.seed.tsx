// COMPONENT: ComponentName
//
// Seed skeleton. Copy this file, rename ComponentName, and implement.
// Follow references/component-pattern.md for the full contract.
//
// Layer: atoms | molecules | organisms
// Update the import path below to match where this component lives.

import { cn } from "@/lib/utils";
// import { Card } from "@/components/ui/card"; // uncomment if wrapping a shadcn primitive

// Props interface: explicitly typed and exported. Name each prop for
// what it IS (emailAddress, maxLoginAttempts), not how it is used.
export interface ComponentNameProps
  extends React.ComponentProps<"div"> {
  // Required props first, then optional with defaults.
  title: string;
  value?: string | number;
}

// Default export of the props type alongside the component.
function ComponentName({
  title,
  value,
  className,
  ...props
}: ComponentNameProps) {
  return (
    <div
      className={cn(
        // Base styling. No magic values; use project tokens.
        "rounded-md border border-border bg-card p-4 text-card-foreground",
        // Six interaction states. All six must be defined.
        "transition-shadow hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "active:scale-[0.98]",
        "disabled:pointer-events-none disabled:opacity-50",
        // Caller className is appended, never replaced.
        className,
      )}
      aria-label={title}
      {...props}
    >
      {/* Content here. Render all four data states (loading, empty, */}
      {/* error, success) if this component fetches data. */}
      <h3 className="text-base font-medium">{title}</h3>
      {value !== undefined && (
        <p className="text-2xl font-semibold">{value}</p>
      )}
    </div>
  );
}

export { ComponentName };
export type { ComponentNameProps };