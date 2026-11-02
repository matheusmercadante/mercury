// THE ISLAND'S WINDOW (w-2a3136a92a). "The icon is very hard to see": the
// corner tag floating over other apps was easy to miss, so on a Mac the tray
// became an island in the notch, the way the reference app (superisland) draws
// one. It does what the tag did, so this pins the same things the tag's tests
// pin, against main/notch-island.mjs: it shows only when something new waits
// and you are in another app, a rest of the pointer opens the list and a click
// opens the app, it hides a while and comes back, it is off only in Settings,
// it goes with the app's window. And what is new for an island: it sits on the
// notch of the screen you are on, above the menu bar, takes no click outside
// its own shape, grows for a moment to show what just arrived, and never has
// its shape cut off by a window that shrank first.
//
// Measured by driving the controller as the app does, with a 14" MacBook Pro
// and a 27" screen (tests/helpers/notch-island-rig.mjs).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOSE_AFTER_MS, OPEN_AFTER_MS, SCREEN_EVERY_MS, SETTLE_MS } from '../main/notch-island.mjs';
import { PEEK_MS } from '../shared/notch-island.mjs';
import { notchIslandRig, DELL, WAITING } from './helpers/notch-island-rig.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Up, with one thread waiting, and the show-off over.
function upAndSettled(opts) {
  const r = notchIslandRig(opts);
  r.hand(WAITING(r.clock()));
  r.pageUp();
  r.advance(PEEK_MS + SETTLE_MS + 10);
  return r;
}

describe('it is the tray on a Mac', () => {
  it('is what the app starts on a Mac, and the corner tag everywhere else', () => {
    const main = fs.readFileSync(path.join(root, 'main/main.mjs'), 'utf8');
    expect(main).toMatch(/cornerTag = process\.platform === 'darwin' \? createNotchIsland\(/);
    expect(main).toMatch(/notch: loadNotch\(\)/);
    expect(main).toMatch(/\}\) : createCornerTag\(/);
  });

  it('counts a hide the way the corner tag does', () => {
    const main = fs.readFileSync(path.join(root, 'main/main.mjs'), 'utf8');
    expect(main).toMatch(/createNotchIsland\(\{[\s\S]{0,300}count: \(name, props\) => analytics\.track\(name, props\)/);
  });
});

describe('it shows when something new waits on you, and only then', () => {
  it('appears once its page is ready, when something waits and you are in another app', () => {
    const r = notchIslandRig();
    r.hand(WAITING(r.clock()));
    expect(r.win().visible).toBe(false);
    r.pageUp();
    expect(r.win().visible).toBe(true);
    expect(r.lastState().ready.map((x) => x.id)).toEqual(['w-1']);
  });

  it('stays away while you are in the app, and comes when you leave and something new arrives', () => {
    const r = notchIslandRig({ focused: true });
    r.hand(WAITING(r.clock()));
    expect(r.win()?.visible ?? false).toBe(false);
    r.leaveApp();
    r.advance(1000);
    r.hand(WAITING(r.clock()));
    expect(r.win()?.visible ?? false).toBe(false);
    r.hand(WAITING(r.clock() + 60_000 + 1, ['w-2']));
    r.pageUp();
    expect(r.win().visible).toBe(true);
    expect(r.lastState().ready.map((x) => x.id)).toEqual(['w-2']);
  });

  it('goes the moment you are back in the app, and when nothing new waits', () => {
    const r = upAndSettled();
    r.enterApp();
    expect(r.win().visible).toBe(false);
    const s = upAndSettled();
    s.hand({ ready: [], working: 3 });
    expect(s.win().visible).toBe(false);
  });

  it('never shows once Settings turned it off', () => {
    const r = notchIslandRig({ config: { cornerTag: false } });
    r.hand(WAITING(r.clock()));
    r.pageUp();
    expect(r.win()?.visible ?? false).toBe(false);
  });
});

describe('it is in the notch', () => {
  it('is a panel above the menu bar, on every Space and over full-screen apps', () => {
    const r = upAndSettled();
    expect(r.win().opts).toMatchObject({ type: 'panel', frame: false, transparent: true, hasShadow: false, focusable: true, enableLargerThanScreen: true });
    expect(r.win().top).toEqual([true, 'status']);
    expect(r.win().everywhere[1]).toMatchObject({ visibleOnFullScreen: true });
  });

  it('is centred on the camera, flush with the top of the screen, as tall as the notch when shut', () => {
    const r = upAndSettled();
    expect(r.win().bounds).toEqual({ x: 756 - 250, y: 0, width: 500, height: 38 });
    expect(r.lastState()).toMatchObject({ mode: 'shut', bar: 38, notch: 186 });
  });

  it('hangs from the top of the screen the pointer is on, even one without a notch', () => {
    const r = notchIslandRig();
    r.cursor.at = { x: 2000, y: 300 };
    r.hand(WAITING(r.clock()));
    r.pageUp();
    expect(r.win().bounds).toMatchObject({ x: 2472 - 250, y: DELL.bounds.y });
    expect(r.lastState()).toMatchObject({ bar: 30, notch: 0 });
  });

  it('follows the pointer to another screen while it is shut', () => {
    const r = upAndSettled();
    r.cursor.at = { x: 2000, y: 300 };
    r.advance(SCREEN_EVERY_MS + 10);
    expect(r.win().bounds).toMatchObject({ x: 2472 - 250, y: -200, height: 38 });
    expect(r.lastState()).toMatchObject({ bar: 30, notch: 0 });
  });

  it('takes no click until the page says the pointer is on the island itself', () => {
    const r = upAndSettled();
    expect(r.win().ignoring[0]).toEqual([true, { forward: true }]);
    r.call('notch-island:clickable', { on: true });
    expect(r.win().ignoring.at(-1)).toEqual([false, { forward: true }]);
    r.call('notch-island:clickable', { on: false });
    expect(r.win().ignoring.at(-1)).toEqual([true, { forward: true }]);
  });

  it('keeps its screen when the screens change, and moves to the notch when its screen goes', () => {
    const r = notchIslandRig();
    r.cursor.at = { x: 2000, y: 300 };
    r.hand(WAITING(r.clock()));
    r.pageUp();
    r.cursor.at = null;
    r.screenListeners['display-metrics-changed']();
    expect(r.win().bounds).toMatchObject({ x: 2472 - 250, y: -200 });
    r.displays.splice(1, 1);
    r.screenListeners['display-removed']();
    expect(r.win().bounds).toMatchObject({ x: 756 - 250, y: 0 });
    expect(r.lastState()).toMatchObject({ bar: 38, notch: 186 });
  });
});

describe('it grows for a moment to show what just arrived', () => {
  it('comes up grown, showing the newest, and settles back on its own', () => {
    const r = notchIslandRig();
    r.hand(WAITING(r.clock(), ['w-2', 'w-1']));
    r.pageUp();
    expect(r.lastState()).toMatchObject({ mode: 'peek', peek: { id: 'w-2' } });
    expect(r.win().bounds.height).toBe(r.SIZES.peek);
    r.advance(PEEK_MS + 1);
    expect(r.lastState().mode).toBe('shut');
  });

  it('keeps the room until the page has shrunk it', () => {
    const r = notchIslandRig();
    r.hand(WAITING(r.clock()));
    r.pageUp();
    r.advance(PEEK_MS + 1);
    expect(r.win().bounds.height).toBe(r.SIZES.peek);
    r.advance(SETTLE_MS);
    expect(r.win().bounds.height).toBe(r.SIZES.shut);
  });

  it('shows off a newcomer, and nothing when a thread only leaves', () => {
    const r = upAndSettled();
    r.hand(WAITING(r.clock() + 1, ['w-3', 'w-1']));
    expect(r.lastState()).toMatchObject({ mode: 'peek', peek: { id: 'w-3' } });
    r.advance(PEEK_MS + SETTLE_MS + 10);
    r.hand(WAITING(r.clock(), ['w-1']));
    expect(r.lastState().mode).toBe('shut');
  });

  it('starts its moment again for a second arrival rather than cutting it short', () => {
    const r = notchIslandRig();
    r.hand(WAITING(r.clock()));
    r.pageUp();
    r.advance(PEEK_MS - 500);
    r.hand(WAITING(r.clock() + 1, ['w-2', 'w-1']));
    r.advance(1000);
    expect(r.lastState()).toMatchObject({ mode: 'peek', peek: { id: 'w-2' } });
  });

  it('does not show the same threads off again when it comes back from a hide', () => {
    const r = upAndSettled();
    r.call('notch-island:hide', '5m');
    expect(r.win().visible).toBe(false);
    r.advance(5 * 60_000 + 100);
    expect(r.win().visible).toBe(true);
    expect(r.lastState().mode).toBe('shut');
  });
});

describe('pointing opens the list and a click opens the app', () => {
  it('opens when the pointer rests on it, with the window grown before the page is told', () => {
    const r = upAndSettled();
    const from = r.events.length;
    r.point();
    expect(r.lastState().mode).toBe('open');
    const after = r.events.slice(from);
    const grew = after.findIndex((e) => e[0] === 'bounds' && e[1].height === r.SIZES.open);
    const told = after.findIndex((e) => e[0] === 'send' && e[2]?.mode === 'open');
    expect(grew).toBeGreaterThanOrEqual(0);
    expect(grew).toBeLessThan(told);
  });

  it('does not open for a pointer only passing over', () => {
    const r = upAndSettled();
    r.call('notch-island:hover', { inside: true });
    r.advance(OPEN_AFTER_MS - 50);
    r.away();
    r.advance(1000);
    expect(r.lastState().mode).toBe('shut');
  });

  it('shuts a moment after the pointer leaves, unless the real cursor is still on it', () => {
    const r = upAndSettled();
    r.point();
    r.call('notch-island:hover', { inside: false });
    r.advance(CLOSE_AFTER_MS + 10);
    expect(r.lastState().mode).toBe('open');
    r.away();
    r.advance(CLOSE_AFTER_MS + 250);
    expect(r.lastState().mode).toBe('shut');
  });

  it('opens the app on a click, and that thread from its line', () => {
    const r = upAndSettled();
    r.call('notch-island:go', null);
    expect(r.main.shown).toBe(1);
    expect(r.main.focused).toBe(true);
    expect(r.win().visible).toBe(false);
    const s = upAndSettled();
    s.point();
    s.call('notch-island:go', 'w-1');
    expect(s.main.sent).toContainEqual(['zero:open-item', { id: 'w-1' }]);
  });

  it('shuts on Escape', () => {
    const r = upAndSettled();
    r.point();
    r.call('notch-island:shut');
    expect(r.lastState().mode).toBe('shut');
  });
});

describe('it never becomes a nag', () => {
  it('crosses a thread off the island and only the island', () => {
    const r = upAndSettled();
    r.hand(WAITING(r.clock(), ['w-1', 'w-2']));
    r.call('notch-island:dismiss', 'w-1');
    expect(r.lastState().ready.map((x) => x.id)).toEqual(['w-2']);
    expect(r.config.cornerTagDismissed).toHaveProperty('w-1');
  });

  it('hides for a while from its menu, and offers nothing permanent there but Settings', () => {
    const r = upAndSettled();
    r.call('notch-island:menu');
    const labels = r.menus.at(-1).template.filter((m) => m.label).map((m) => m.label);
    expect(labels).toEqual(['Hide for 5 minutes', 'Hide for 30 minutes', 'Hide for the rest of today', 'Turn off in Settings…']);
    r.menus.at(-1).template[1].click();
    expect(r.win().visible).toBe(false);
    expect(r.counted).toContainEqual(['tag_hidden', { seconds: 1800 }]);
    r.advance(30 * 60_000 + 100);
    expect(r.win().visible).toBe(true);
  });

  it('goes with the app\'s window, and lets go of everything it listened to', () => {
    const r = upAndSettled();
    r.mainListeners.closed();
    expect(r.win().destroyed).toBe(true);
    expect(r.removed).toContain('zero:corner-tag');
    expect(r.removed).toContain('notch-island:hover');
  });

  it('is put away while its page reloads and comes back when it is ready', () => {
    const r = upAndSettled();
    r.win().heard['did-start-loading']();
    expect(r.win().visible).toBe(false);
    r.hand(WAITING(r.clock()));
    expect(r.win().visible).toBe(false);
    r.call('notch-island:ready');
    expect(r.win().visible).toBe(true);
  });
});
