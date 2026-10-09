/** Where the tab strip is known to be, and whether the user has scrolled it themselves. */
export interface StripScroll {
  /** The `scrollLeft` the strip was last put at or found at; null before either. */
  readonly at: number | null;
  /** The user scrolled the strip themselves, and no other tab has been opened since. */
  readonly moved: boolean;
}

export const STRIP_AT_REST: StripScroll = { at: null, moved: false };

/**
 * The strip after a `scroll` event that found it at `left`, of `max` it can scroll. No input is
 * listened for: a wheel, a drag, its momentum, a key and a focus that scrolls all end in this one
 * event, and so does the strip's own placing. They are told apart by where the strip is: its own
 * scroll finds it exactly where it was put (`stripPlaced` has the value the browser kept), and a
 * shorter row (a face that drew the names narrower, a tab renamed or closed) that the browser
 * pulled back is at its new end, short of where it was. Anywhere else, the user took it there.
 */
export function stripScrolled(was: StripScroll, left: number, max: number): StripScroll {
  if (left === was.at) return was;
  if (was.at !== null && left < was.at && left >= max - 1) return { at: left, moved: was.moved };
  return { at: left, moved: true };
}

/** The strip once it has put itself at `left`, as read back from it. */
export function stripPlaced(was: StripScroll, left: number): StripScroll {
  return { at: left, moved: was.moved };
}

/** A tab was opened: the strip follows the open tab again, whatever the user did before. */
export function stripSelected(was: StripScroll): StripScroll {
  return was.moved ? { at: was.at, moved: false } : was;
}
