// Sidebar channel view: the shared layout (mod/panel-layout.ts) as elements. No view logic lives here.
import type { ClientElements, RenderElement } from 'claude-code';
import { viewRows } from './sidebar-paint';
import type { SidebarHandlers, SidebarModel } from './sidebar-types';

export const channelRows = (els: ClientElements, m: SidebarModel, on: SidebarHandlers, inner: number): RenderElement[] => viewRows('channel', els, m, on, inner);
