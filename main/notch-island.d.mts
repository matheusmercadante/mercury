// Types for main/notch-island.mjs, the tray in the notch on a Mac. It takes
// what the corner tag takes, but one page instead of two and where the notch is.
import type { BrowserWindow } from 'electron';
import type { CornerTagDeps } from './corner-tag.mts';
import type { ReadNotch } from './liquid-glass.mts';

export const CLOSE_AFTER_MS: number;
export const OPEN_AFTER_MS: number;
/** How long the page takes to shrink the island; the window keeps the room until it has. */
export const SETTLE_MS: number;
/** How often, while it is up and shut, it looks for the pointer on another screen. */
export const SCREEN_EVERY_MS: number;

export interface NotchIslandDeps extends Omit<CornerTagDeps, 'load'> {
  load: (win: BrowserWindow) => unknown;
  /** The notch on a display, by its id (main/liquid-glass.mts, loadNotch). */
  notch?: ReadNotch;
}

export interface NotchIsland {
  refresh(): void;
  dispose(): void;
  /** Tests, and nothing else. */
  _state(): { ready: unknown[]; working: number; mode: string; anchor: unknown; tone: unknown; visible: unknown; bounds: unknown };
}

export function createNotchIsland(deps: NotchIslandDeps): NotchIsland;
