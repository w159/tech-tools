// Contract for the Spinner globe tick (mod/restyle.tsx): a counter advanced by a
// $.clock.every timer while the Spinner is mounted. The Spinner render hook reads it,
// so only the Spinner site redraws per tick. Needs listing in plugin.json "types".
export type SpinnerTick = number

declare module 'claude-code' {
  interface PluginState {
    atlas: { spinnerTick: SpinnerTick }
  }
}
