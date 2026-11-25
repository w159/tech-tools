export type BoredCell = { ch: string; fg: number | null; bg: number | null }
export type BoredScreen = { cols: number; rows: number; cells: readonly (readonly BoredCell[])[] }
export type BoredStatus = 'connecting' | 'streaming' | 'error' | 'closed'
export type BoredView = { status: BoredStatus; error?: string; screen: BoredScreen | null; seq: number }
