// Atlas mod contract: types the mod's hooks modules import and the engine
// reads via the plugin.json "types" field. See the passage in
// .claude-plugin/types/claude-code/index.d.ts on plugins that add a noun to `$`.

export type PluginState = {
    /** Which full-screen pane the mod is showing. */
    tab: 'colony' | 'channel' | 'board' | 'squad';
    /** Whether the collapsible side pane is open. */
    paneOpen: boolean;
    /** Whether UI sound effects are enabled. */
    sound: boolean;
    /** Highest event sequence number the mod has rendered. */
    lastSeenSeq: number;
};

declare module 'claude-code' {
    interface EngineInterface {
        atlasMod: PluginState;
    }
}
