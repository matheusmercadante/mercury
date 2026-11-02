// THE ISLAND'S WINDOW (w-2a3136a92a). "The icon is very hard to see": the
// corner tag floating over other apps was easy to miss, so on a Mac the tray
// became an island in the notch, the way the reference app (superisland) draws
// one, but in the tray's own style: "let's have the dynamic island but with
// the style that already exists", after a black one was sent back. And it is
// there only when threads need you, "like it is today with this icon".
//
// So this pins what the tag's own tests pin, against main/notch-island.mjs: it
// shows only when something new waits and you are in another app, a rest of
// the pointer opens the list and a click opens the app, it hides a while and
// comes back, it is off only in Settings, it goes with the app's window. What
// is new for an island: it sits on the notch of the screen you are on, above
// the menu bar, takes no click outside its own shape, wears the Mac's glass
// exactly where the page draws it, and never has its shape cut off by a window
// that shrank first. It does not grow on its own: nothing about it moves
// unless you point at it.
//
// Measured by driving the controller as the app does, with a 14" MacBook Pro
// and a 27" screen (tests/helpers/notch-island-rig.mjs).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOSE_AFTER_MS, OPEN_AFTER_MS, SCREEN_EVERY_MS, SETTLE_MS } from '../main/notch-island.mjs';
import { TONE_EVERY_MS } from '../main/corner-tag.mjs';
import { tagScaleOn } from '../shared/corner-tag.mjs';
import { notchIslandRig, fakeGlass, DELL, WAITING } from './helpers/notch-island-rig.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Up, with one thread waiting.
function up(opts) {
  const r = notchIslandRig(opts);
  r.hand(WAITING(r.clock()));
  r.pageUp();
  return r;
}

describe('it is the tray on a Mac', () => {
  it('is what the app starts on a Mac, in the same glass, and the corner tag everywhere else', () => {
    const main = fs.readFileSync(path.join(root, 'main/main.mjs'), 'utf8');
    expect(main).toMatch(/cornerTag = process\.platform === 'darwin' \? createNotchIsland\(/);
    expect(main).toMatch(/notch: loadNotch\(\)/);
    expect(main).toMatch(/trayCommon = \{[\s\S]{0,200}glass: loadLiquidGlass\(\)/);
    expect(main).toMatch(/\}\) : createCornerTag\(/);
  });

  it('counts a hide the way the corner tag does', () => {
    const main = fs.readFileSync(path.join(root, 'main/main.mjs'), 'utf8');
    expect(main).toMatch(/createNotchIsland\(\{[\s\S]{0,300}count: \(name, props\) => analytics\.track\(name, props\)/);
  });

  it('is drawn with the tray\'s own glass, ink and list, and no colour of its own', () => {
    const css = fs.readFileSync(path.join(root, 'renderer/src/notch-island/notch-island.css'), 'utf8');
    const rules = css.slice(0, css.indexOf('the pictures only'));
    expect(rules).toMatch(/background: var\(--ct-tint\)/);
    expect(rules).toMatch(/color: var\(--ct-ink\)/);
    // A fill of its own; the rim's mask is black by how masks work, not a colour.
    expect(rules).not.toMatch(/background(-color)?:\s*(#000\b|#000000|black|rgba?\(0, 0, 0(, 1)?\))/);
    expect(rules).not.toMatch(/background(-color)?:\s*#[0-9a-f]{3,6}\b/i);
    const page = fs.readFileSync(path.join(root, 'renderer/src/notch-island/main.tsx'), 'utf8');
    expect(page).toContain("import '../corner-tag/corner-tag.css'");
    expect(page).toContain('className="ct-line"');
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
    const r = up();
    r.enterApp();
    expect(r.win().visible).toBe(false);
    const s = up();
    s.hand({ ready: [], working: 3 });
    expect(s.win().visible).toBe(false);
  });

  it('never shows once Settings turned it off', () => {
    const r = notchIslandRig({ config: { cornerTag: false } });
    r.hand(WAITING(r.clock()));
    r.pageUp();
    expect(r.win()?.visible ?? false).toBe(false);
  });

  it('comes up shut, and stays shut as threads arrive, until you point at it', () => {
    const r = up();
    expect(r.lastState().mode).toBe('shut');
    r.hand(WAITING(r.clock() + 1, ['w-3', 'w-1']));
    expect(r.lastState()).toMatchObject({ mode: 'shut', ready: [{ id: 'w-3' }, { id: 'w-1' }] });
    expect(r.win().bounds.height).toBe(r.SIZES.shut);
  });
});

describe('it is in the notch', () => {
  it('is a panel above the menu bar, on every Space and over full-screen apps', () => {
    const r = up();
    expect(r.win().opts).toMatchObject({ type: 'panel', frame: false, transparent: true, hasShadow: false, focusable: true, enableLargerThanScreen: true });
    expect(r.win().top).toEqual([true, 'status']);
    expect(r.win().everywhere[1]).toMatchObject({ visibleOnFullScreen: true });
  });

  it('is centred on the camera, flush with the top of the screen, as tall as the notch when shut', () => {
    const r = up();
    expect(r.win().bounds).toEqual({ x: 756 - 250, y: 0, width: 500, height: 38 });
    expect(r.lastState()).toMatchObject({ mode: 'shut', bar: 38, notch: 186 });
  });

  it('is drawn at the tray\'s size for the screen it is on', () => {
    const r = up();
    expect(r.lastState().scale).toBe(tagScaleOn(1512, 1));
  });

  it('hangs from the top of the screen the pointer is on, even one without a notch', () => {
    const r = notchIslandRig();
    r.cursor.at = { x: 2000, y: 300 };
    r.hand(WAITING(r.clock()));
    r.pageUp();
    expect(r.win().bounds).toMatchObject({ x: 2472 - 250, y: DELL.bounds.y });
    expect(r.lastState()).toMatchObject({ bar: 30, notch: 0, scale: tagScaleOn(1920, 1) });
  });

  it('follows the pointer to another screen while it is shut', () => {
    const r = up();
    r.cursor.at = { x: 2000, y: 300 };
    r.advance(SCREEN_EVERY_MS + 10);
    expect(r.win().bounds).toMatchObject({ x: 2472 - 250, y: -200, height: 38 });
    expect(r.lastState()).toMatchObject({ bar: 30, notch: 0 });
  });

  it('takes no click until the page says the pointer is on the island itself', () => {
    const r = up();
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

describe('it wears the tray\'s glass', () => {
  it('tells the page the Mac draws the glass, so the page draws none', () => {
    expect(up({ glass: fakeGlass() }).lastState().glass).toBe(true);
    expect(up().lastState().glass).toBe(false);
  });

  it('lays the glass exactly where the page draws the island, its top run up past the screen\'s edge', () => {
    const glass = fakeGlass();
    const r = up({ glass });
    r.call('notch-island:shape', { x: 109, y: 0, width: 282, height: 38, radius: 7 });
    expect(glass.laid.at(-1)).toEqual({ rect: { x: 109, y: -7, width: 282, height: 45 }, opts: { radius: 7, style: 'clear' } });
  });

  it('is the tag\'s clear glass while shut and the list\'s glass while open, frame by frame', () => {
    const glass = fakeGlass();
    const r = up({ glass });
    r.call('notch-island:shape', { x: 109, y: 0, width: 282, height: 38, radius: 7 });
    r.point();
    r.call('notch-island:shape', { x: 90, y: 0, width: 320, height: 120, radius: 8 });
    r.call('notch-island:shape', { x: 70, y: 0, width: 360, height: 190, radius: 8 });
    const last = glass.laid.at(-1);
    expect(last.rect).toEqual({ x: 70, y: -8, width: 360, height: 198 });
    expect(last.opts.style).toBeUndefined();
  });

  it('turns its ink with how bright the screen behind it is, as the tag does', () => {
    const glass = fakeGlass(0.9);
    const r = up({ glass });
    r.call('notch-island:shape', { x: 109, y: 0, width: 282, height: 38, radius: 7 });
    r.advance(TONE_EVERY_MS + 10);
    expect(r.win().sent).toContainEqual(['notch-island:tone', 'light']);
    expect(glass.laid.at(-1).opts).toMatchObject({ style: 'clear', tone: 'light' });
  });

  it('ignores a shape with no size', () => {
    const glass = fakeGlass();
    const r = up({ glass });
    const before = glass.laid.length;
    r.call('notch-island:shape', { x: 0, y: 0, width: 0, height: 38, radius: 7 });
    r.call('notch-island:shape', null);
    expect(glass.laid.length).toBe(before);
  });
});

describe('pointing opens the list and a click opens the app', () => {
  it('opens when the pointer rests on it, with the window grown before the page is told', () => {
    const r = up();
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
    const r = up();
    r.call('notch-island:hover', { inside: true });
    r.advance(OPEN_AFTER_MS - 50);
    r.away();
    r.advance(1000);
    expect(r.lastState().mode).toBe('shut');
  });

  it('shuts a moment after the pointer leaves, unless the real cursor is still on it', () => {
    const r = up();
    r.point();
    r.call('notch-island:hover', { inside: false });
    r.advance(CLOSE_AFTER_MS + 10);
    expect(r.lastState().mode).toBe('open');
    r.away();
    r.advance(CLOSE_AFTER_MS + 250);
    expect(r.lastState().mode).toBe('shut');
  });

  it('keeps the room until the page has shrunk it', () => {
    const r = up();
    r.point();
    r.away();
    r.advance(CLOSE_AFTER_MS + 250);
    expect(r.lastState().mode).toBe('shut');
    expect(r.win().bounds.height).toBe(r.SIZES.open);
    r.advance(SETTLE_MS);
    expect(r.win().bounds.height).toBe(r.SIZES.shut);
  });

  it('opens the app on a click, and that thread from its line', () => {
    const r = up();
    r.call('notch-island:go', null);
    expect(r.main.shown).toBe(1);
    expect(r.main.focused).toBe(true);
    expect(r.win().visible).toBe(false);
    const s = up();
    s.point();
    s.call('notch-island:go', 'w-1');
    expect(s.main.sent).toContainEqual(['zero:open-item', { id: 'w-1' }]);
  });

  it('shuts on Escape', () => {
    const r = up();
    r.point();
    r.call('notch-island:shut');
    expect(r.lastState().mode).toBe('shut');
  });
});

describe('it never becomes a nag', () => {
  it('crosses a thread off the island and only the island', () => {
    const r = up();
    r.hand(WAITING(r.clock(), ['w-1', 'w-2']));
    r.call('notch-island:dismiss', 'w-1');
    expect(r.lastState().ready.map((x) => x.id)).toEqual(['w-2']);
    expect(r.config.cornerTagDismissed).toHaveProperty('w-1');
  });

  it('is made bigger or smaller from its list, kept the way the tag keeps it', () => {
    const r = up();
    r.call('notch-island:resize', { by: 1 });
    expect(r.config.cornerTagZoom).toBe(1.1);
    expect(r.lastState().scale).toBe(tagScaleOn(1512, 1.1));
  });

  it('hides for a while from its menu, and offers nothing permanent there but Settings', () => {
    const r = up();
    r.call('notch-island:menu');
    const labels = r.menus.at(-1).template.filter((m) => m.label).map((m) => m.label);
    expect(labels).toEqual(['Bigger', 'Smaller', 'Size for this screen', 'Hide for 5 minutes', 'Hide for 30 minutes', 'Hide for the rest of today', 'Turn off in Settings…']);
    r.menus.at(-1).template.find((m) => m.label === 'Hide for 30 minutes').click();
    expect(r.win().visible).toBe(false);
    expect(r.counted).toContainEqual(['tag_hidden', { seconds: 1800 }]);
    r.advance(30 * 60_000 + 100);
    expect(r.win().visible).toBe(true);
  });

  it('goes with the app\'s window, and lets go of everything it listened to', () => {
    const r = up();
    r.mainListeners.closed();
    expect(r.win().destroyed).toBe(true);
    expect(r.removed).toContain('zero:corner-tag');
    expect(r.removed).toContain('notch-island:shape');
  });

  it('is put away while its page reloads and comes back when it is ready', () => {
    const r = up();
    r.win().heard['did-start-loading']();
    expect(r.win().visible).toBe(false);
    r.hand(WAITING(r.clock()));
    expect(r.win().visible).toBe(false);
    r.call('notch-island:ready');
    expect(r.win().visible).toBe(true);
  });
});
