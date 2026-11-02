// THE TRAY UNDER THE NOTCH (w-2a3136a92a). "The icon is very hard to see": in a
// corner the tray was easy to miss, so on a Mac it sits centred just under the
// notch of the screen you are on, or under the middle of the menu bar on a
// screen without one. A black island fused to the notch was tried first and
// sent back ("not the app's style, that black is too strong; follow what the
// tray already does"), so it is the same tray, glass and list and rules, and
// only its place changed. Without these it would sit off-centre from the
// camera, on a screen you are not looking at, or move when pressed.
//
// Measured with a 14" MacBook Pro's notch (about 186 x 38 points at its default
// size, a stand-in: the real one is read from macOS at run time) and the 27"
// Dell beside it, which macOS gave a 30-point menu bar and no notch when read
// on 2026-11-01.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BAR_FALLBACK, LIST_GAP, NOTCH_GAP, displayUnder, listUnder, notchAnchor, underNotch } from '../shared/tray-notch.mjs';
import { createCornerTag, DRAG_FROM_PX } from '../main/corner-tag.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAPTOP = { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 38, width: 1512, height: 944 } };
const LAPTOP_NOTCH = { x: 663, width: 186, height: 38 };
const DELL = { id: 3, bounds: { x: 1512, y: -200, width: 1920, height: 1080 }, workArea: { x: 1512, y: -170, width: 1920, height: 1050 } };
// The tag's page: a window 100 x 46 with its glass 80 x 26, ten points in.
const TAG = { part: 'tag', width: 100, height: 46, glass: { x: 10, y: 10, width: 80, height: 26 } };

describe('where under the notch', () => {
  it('is the middle of the notch, the notch\'s height down from the top', () => {
    expect(notchAnchor(LAPTOP, LAPTOP_NOTCH)).toEqual({ centerX: 756, top: 0, bar: 38, notch: 186 });
  });

  it('is the middle of the top edge, the menu bar\'s height down, on a screen without one', () => {
    expect(notchAnchor(DELL, null)).toEqual({ centerX: 2472, top: -200, bar: 30, notch: 0 });
  });

  it('takes a reading of no width as no notch', () => {
    expect(notchAnchor(LAPTOP, { x: 756, width: 0, height: 38 }).notch).toBe(0);
  });

  it('uses the usual menu bar where the menu bar hides itself or says something odd', () => {
    expect(notchAnchor({ ...DELL, workArea: { ...DELL.bounds } }, null).bar).toBe(BAR_FALLBACK);
    expect(notchAnchor({ ...DELL, workArea: { ...DELL.workArea, y: DELL.bounds.y + 120 } }, null).bar).toBe(BAR_FALLBACK);
    expect(notchAnchor({ bounds: DELL.bounds }, null).bar).toBe(BAR_FALLBACK);
  });

  it('puts the middle of the glass, not of the window, under the camera, the gap below the strip', () => {
    const at = underNotch(notchAnchor(LAPTOP, LAPTOP_NOTCH), TAG.glass);
    expect(at).toEqual({ x: 756 - 50, y: 38 + NOTCH_GAP - 10 });
    expect(at.x + TAG.glass.x + TAG.glass.width / 2).toBe(756);
  });

  it('opens the list centred under the glass, and keeps it on the screen', () => {
    const glass = { x: 716, y: 44, width: 80, height: 26 };
    expect(listUnder(glass, { width: 300, height: 110 }, LAPTOP.workArea)).toEqual({ x: 606, y: 44 + 26 + LIST_GAP, width: 300, height: 110 });
    expect(listUnder({ ...glass, x: 10 }, { width: 300, height: 110 }, LAPTOP.workArea).x).toBe(0);
  });
});

describe('which screen', () => {
  it('is the one the pointer is on, its very edge included', () => {
    expect(displayUnder({ x: 2000, y: 100 }, [LAPTOP, DELL])).toBe(DELL);
    expect(displayUnder({ x: 1511, y: 10 }, [LAPTOP, DELL])).toBe(LAPTOP);
    expect(displayUnder({ x: 1512, y: 10 }, [LAPTOP, DELL])).toBe(DELL);
  });

  it('is the first one with no pointer, or a pointer between screens', () => {
    expect(displayUnder(null, [LAPTOP, DELL])).toBe(LAPTOP);
    expect(displayUnder({ x: 1000, y: 2000 }, [LAPTOP, DELL])).toBe(LAPTOP);
    expect(displayUnder({ x: 0, y: 0 }, [])).toBe(null);
  });
});

// The tray as the app drives it, with two screens, a pointer and a clock.
function rig({ mac = true, notches = { 1: LAPTOP_NOTCH }, withNotch = true, focused = false } = {}) {
  const handlers = {};
  const timers = [];
  let timerId = 0;
  let clock = 1_000_000_000;
  const windows = [];
  class FakeWindow {
    constructor(opts) {
      this.opts = opts; this.bounds = null; this.visible = false; this.destroyed = false; this.sent = [];
      this.webContents = { send: (ch, p) => this.sent.push([ch, p]), on: () => {}, setZoomFactor: () => {} };
      windows.push(this);
    }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    on() {}
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.visible = false; }
    isVisible() { return this.visible; }
    hide() { this.visible = false; }
    showInactive() { this.visible = true; }
    setBounds(b) { this.bounds = b; }
    getBounds() { return this.bounds; }
    setPosition(x, y) { this.bounds = { ...this.bounds, x, y }; }
    setIgnoreMouseEvents() {}
  }
  const displays = [LAPTOP, DELL];
  const cursor = { at: null };
  const listeners = {};
  const screen = {
    getAllDisplays: () => displays,
    getDisplayMatching: (r) => displayUnder({ x: r.x + r.width / 2, y: r.y + r.height / 2 }, displays),
    getCursorScreenPoint: () => cursor.at,
    on: (ev, fn) => { listeners[ev] = fn; }, removeListener: () => {},
  };
  const mainListeners = {};
  const main = {
    focused, shown: 0, sent: [],
    isDestroyed: () => false, isFocused() { return this.focused; }, isMinimized: () => false,
    restore() {}, show() { this.shown++; }, focus() { this.focused = true; },
    on(ev, fn) { mainListeners[ev] = fn; },
    webContents: { send: (ch, p) => main.sent.push([ch, p]) },
  };
  createCornerTag({
    BrowserWindow: FakeWindow, screen, ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, removeHandler: () => {} },
    powerMonitor: { on: () => {}, removeListener: () => {} }, Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
    config: {}, saveConfig: (c, p) => Object.assign(c, p), mainWindow: main, load: (w, part) => { w.part = part; }, preload: '/p.cjs',
    now: () => clock,
    setTimer: (fn, ms) => { const id = ++timerId; timers.push({ id, fn, at: clock + ms }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    mac, ...(withNotch ? { notch: (id) => notches[id] ?? null } : {}),
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
  const win = (part = 'tag') => windows.filter((w) => w.part === part).at(-1);
  const state = () => win().sent.filter((s) => s[0] === 'corner-tag:state').at(-1)?.[1];
  // Threads that started waiting `ago` ms back; a negative one is just now.
  const waiting = (ids = ['w-1'], ago = 60_000) => call('zero:corner-tag', {
    ready: ids.map((id) => ({ id, title: id, says: 'is ready for you', since: clock - ago })), working: 2,
  });
  const pageUp = () => { call('corner-tag:ready', { part: 'tag' }); call('corner-tag:size', TAG); };
  const up = () => { waiting(); pageUp(); };
  return {
    call, advance, win, state, waiting, pageUp, up, displays, cursor, listeners, main, mainListeners,
    leaveApp: () => { main.focused = false; mainListeners.blur?.(); },
    enterApp: () => { main.focused = true; mainListeners.focus?.(); },
  };
}

describe('the tray on a Mac', () => {
  it('sits centred under the notch, its glass the gap below it', () => {
    const r = rig();
    r.up();
    expect(r.win().visible).toBe(true);
    expect(r.win().bounds).toEqual({ x: 706, y: 34, width: 100, height: 46 });
    expect(r.state().atNotch).toBe(true);
  });

  it('sits under the middle of the menu bar of the screen the pointer is on, notch or not', () => {
    const r = rig();
    r.cursor.at = { x: 2000, y: 300 };
    r.up();
    expect(r.win().bounds).toEqual({ x: 2422, y: -200 + 30 + NOTCH_GAP - 10, width: 100, height: 46 });
  });

  it('comes back under the screen you are on when it next appears', () => {
    const r = rig();
    r.up();
    r.enterApp();
    expect(r.win().visible).toBe(false);
    r.cursor.at = { x: 2000, y: 300 };
    r.advance(1000);
    r.leaveApp();
    r.advance(1000);
    r.waiting(['w-2'], -1);
    expect(r.win().visible).toBe(true);
    expect(r.win().bounds.x).toBe(2422);
  });

  it('comes only when something new waits on you while you are in another app, and goes when you are back', () => {
    const r = rig({ focused: true });
    r.waiting();
    expect(r.win()?.visible ?? false).toBe(false);
    r.leaveApp();
    r.waiting();
    r.call('zero:corner-tag', { ready: [], working: 4 });
    expect(r.win()?.visible ?? false).toBe(false);
    r.waiting(['w-2'], -1);
    r.pageUp();
    expect(r.win().visible).toBe(true);
    r.enterApp();
    expect(r.win().visible).toBe(false);
  });

  it('opens its list centred under it', () => {
    const r = rig();
    r.up();
    r.call('corner-tag:toggle');
    r.call('corner-tag:ready', { part: 'card' });
    r.call('corner-tag:size', { part: 'card', width: 300, height: 110 });
    expect(r.win('card').bounds).toEqual({ x: 606, y: 44 + 26 + LIST_GAP, width: 300, height: 110 });
  });

  it('does not move when pressed and pulled, and a click still opens the app', () => {
    const r = rig();
    r.up();
    const before = { ...r.win().bounds };
    r.cursor.at = { x: 756, y: 50 };
    r.call('corner-tag:press', { x: 756, y: 50 });
    r.cursor.at = { x: 756 + DRAG_FROM_PX + 30, y: 90 };
    r.advance(64);
    r.call('corner-tag:release', { cancelled: false });
    expect(r.win().bounds).toEqual(before);
    expect(r.main.shown).toBe(0);
    expect(r.win().sent.some((s) => s[0] === 'corner-tag:dragging')).toBe(false);
    r.cursor.at = { x: 756, y: 50 };
    r.call('corner-tag:press', { x: 756, y: 50 });
    r.call('corner-tag:release', { cancelled: false });
    expect(r.main.shown).toBe(1);
  });

  it('offers no corner to move to', () => {
    const r = rig();
    r.up();
    const before = { ...r.win().bounds };
    r.call('corner-tag:place', 'tl');
    expect(r.win().bounds).toEqual(before);
    const page = fs.readFileSync(path.join(root, 'renderer/src/corner-tag/main.tsx'), 'utf8');
    expect(page).toContain('{!state.atNotch && <MoveButton');
  });

  it('may reach up into the menu bar with its clear band, where a window is otherwise pushed down', () => {
    const r = rig();
    r.up();
    expect(r.win().opts.enableLargerThanScreen).toBe(true);
  });

  it('goes under the laptop\'s notch when the screen it was on goes', () => {
    const r = rig();
    r.cursor.at = { x: 2000, y: 300 };
    r.up();
    r.cursor.at = null;
    r.displays.splice(1, 1);
    r.listeners['display-removed']();
    expect(r.win().bounds).toMatchObject({ x: 706, y: 34 });
  });

  it('stays in a corner off a Mac and without the notch reading', () => {
    for (const r of [rig({ mac: false }), rig({ withNotch: false })]) {
      r.up();
      expect(r.win().bounds.y).toBeGreaterThan(500);
      expect(r.win().opts.enableLargerThanScreen).toBeUndefined();
      expect(r.state().atNotch).toBe(false);
    }
  });

  it('is what the app starts, with the notch read from the Mac', () => {
    const main = fs.readFileSync(path.join(root, 'main/main.mjs'), 'utf8');
    expect(main).toMatch(/createCornerTag\(\{[\s\S]{0,400}notch: loadNotch\(\)/);
  });
});
