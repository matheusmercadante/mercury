// A pretend app around main/notch-island.mjs: one window, screens with and
// without a notch, a cursor, a clock, the app's own window gaining and losing
// focus, and the store of settings.
import { createNotchIsland } from '../../main/notch-island.mjs';

// A 14" MacBook Pro at its default size (its notch a stand-in, near the real
// one), and the 27" screen beside it as macOS described it on 2026-11-01.
export const LAPTOP = { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 38, width: 1512, height: 944 } };
export const LAPTOP_NOTCH = { x: 663, width: 186, height: 38 };
export const DELL = { id: 3, bounds: { x: 1512, y: -200, width: 1920, height: 1080 }, workArea: { x: 1512, y: -170, width: 1920, height: 1050 } };

export function notchIslandRig({ config = {}, focused = false, at = 1_000_000_000, displays = [LAPTOP, DELL], notches = { 1: LAPTOP_NOTCH } } = {}) {
  const handlers = {};
  const removed = [];
  const timers = [];
  let timerId = 0;
  let clock = at;
  const windows = [];
  // Every resize and every message to the page, in the order they happened.
  const events = [];
  class FakeWindow {
    constructor(opts) {
      this.opts = opts; this.bounds = null; this.visible = false; this.destroyed = false; this.sent = [];
      this.heard = {}; this.ignoring = [];
      this.webContents = {
        send: (ch, p) => { this.sent.push([ch, p]); events.push(['send', ch, p]); },
        on: (ev, fn) => { this.heard[ev] = fn; },
        setZoomFactor: () => {},
      };
      windows.push(this);
    }
    setAlwaysOnTop(on, level) { this.top = [on, level]; }
    setVisibleOnAllWorkspaces(on, o) { this.everywhere = [on, o]; }
    on() {}
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.visible = false; }
    isVisible() { return this.visible; }
    hide() { this.visible = false; }
    showInactive() { this.visible = true; }
    setBounds(b) { this.bounds = b; events.push(['bounds', b]); }
    getBounds() { return this.bounds; }
    setIgnoreMouseEvents(ignore, o) { this.ignoring.push([ignore, o]); }
  }
  const cursor = { at: null };
  const screenListeners = {};
  const screen = {
    getAllDisplays: () => displays,
    getCursorScreenPoint: () => cursor.at,
    on: (ev, fn) => { screenListeners[ev] = fn; }, removeListener: () => {},
  };
  const mainListeners = {};
  const main = {
    focused, destroyed: false, sent: [], shown: 0,
    isDestroyed() { return this.destroyed; }, isFocused() { return this.focused; }, isMinimized: () => false,
    restore() {}, show() { this.shown++; }, focus() { this.focused = true; mainListeners.focus?.(); },
    on(ev, fn) { mainListeners[ev] = fn; },
    webContents: { send: (ch, p) => main.sent.push([ch, p]) },
  };
  const saved = [];
  const counted = [];
  const saveConfig = (c, patch) => { Object.assign(c, patch); saved.push(patch); };
  const menus = [];
  const island = createNotchIsland({
    BrowserWindow: FakeWindow, screen,
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, removeHandler: (ch) => removed.push(ch) },
    powerMonitor: { on: () => {}, removeListener: () => {} },
    Menu: { buildFromTemplate: (t) => ({ popup: (o) => menus.push({ template: t, ...o }) }) },
    config, saveConfig, mainWindow: main, load: (w) => { w.loaded = true; }, preload: '/p.cjs',
    notch: (id) => notches[id] ?? null,
    count: (name, props) => counted.push([name, props]),
    now: () => clock,
    setTimer: (fn, ms) => { const id = ++timerId; timers.push({ id, fn, at: clock + ms }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    mac: true,
  });
  const call = (ch, p) => handlers[ch](null, p);
  const advance = (ms) => {
    const target = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > target) break;
      timers.shift();
      clock = next.at;
      next.fn();
    }
    clock = target;
  };
  const win = () => windows.at(-1);
  const lastState = () => win()?.sent.filter((s) => s[0] === 'notch-island:state').at(-1)?.[1];
  const hand = (state) => call('zero:corner-tag', state);
  // The page loads and says how big the island gets.
  const SIZES = { width: 500, shut: 38, peek: 90, open: 230 };
  const pageUp = (sizes = SIZES) => {
    call('notch-island:ready');
    call('notch-island:size', sizes);
  };
  const leaveApp = () => { main.focused = false; mainListeners.blur?.(); };
  const enterApp = () => { main.focused = true; mainListeners.focus?.(); };
  // The pointer on the island, resting long enough to mean it.
  const point = (ms = 300) => { const b = win().bounds; cursor.at = { x: b.x + b.width / 2, y: b.y + 10 }; call('notch-island:hover', { inside: true }); advance(ms); };
  const away = () => { cursor.at = { x: 5, y: 600 }; call('notch-island:hover', { inside: false }); };
  return {
    island, call, windows, win, lastState, hand, pageUp, leaveApp, enterApp, point, away, main, config, saved, counted,
    advance, timers, cursor, menus, removed, screenListeners, mainListeners, events, displays, SIZES, clock: () => clock,
  };
}

export const WAITING = (now, ids = ['w-1']) => ({
  ready: ids.map((id, i) => ({ id, title: `Thread ${id}`, says: 'is ready for you', since: now - (i + 1) * 60_000 })),
  working: 2,
});
