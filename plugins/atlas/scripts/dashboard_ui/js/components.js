// Atlas Command Center component library (MASTER section 9). Plain DOM factories; every string reaches the
// page via textContent, so API data can never inject markup. Status is always glyph + word.
//
// Families (all exported from this module):
//   9.1  HexGlyph, StatusDot, Badge, describeStatus
//   9.2  AgentRow         9.3 AgentCard        9.6 Inspector (fleet.js)
//   9.4  PaneTile         9.5 FeedItem, DayHeader, Timeline
//   9.7  Kpi, Sparkline   9.8 Table            9.9 Tabs, tabPanelProps
//   9.10 Drawer/openDrawer/closeDrawer, Modal/openModal/closeModal/confirm, openPopover/openMenu, openPalette
//   9.11 ChannelMessage, ChannelList           9.12 Composer
//   9.13 State, EmptyState                     9.14 DegradedState
//   9.15 toast, toastError                     9.16 Button, IconButton, Chip, Keycap, Input, Select
// Also: Card, CommandBlock, LineChart, BarChart, StateBar, Terminal, LogView, FilterBar, stripAnsi, fuzzy.

export * from "./ui-core.js";
export * from "./ui-overlays.js";
export * from "./ui-data.js";
export { AgentRow, AgentCard, Inspector } from "./fleet.js";
