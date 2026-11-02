// THE ISLAND'S WINDOW (w-2a3136a92a). shared/notch-island.mjs says where it
// hangs; this is the live half. One window, a panel above the menu bar, as
// wide as the island ever gets and as tall as it is about to be. The page draws
// the island and moves it between its two sizes: shut, the mark on one side of
// the camera and the count on the other, and open, the tray's list. The window
// grows before the island does and shrinks only once it has, so the shape is
// never cut off while it moves.
//
// IT WEARS THE TRAY'S GLASS, NOT ITS OWN. A black island fused to the notch was
// built first and sent back: "not the app's style, that black is too strong;
// keep the design that exists". So it is the corner tag's material exactly
// (main/corner-tag.mjs): the Mac's own Liquid Glass where there is one, clear
// while shut like the tag and regular while open like its list, with the ink
// following how bright the screen behind it is. The page reports the island's
// shape on every frame it moves, and the glass is put there.
//
// What it keeps from the corner tag, each learned there:
// - It may take focus, so a press on it never brings the app's window forward.
// - What is clear in the window is not the island. The page says what is under
//   the pointer, and a click anywhere else goes through to what is underneath.
// - Resting the pointer on it opens the list and a click opens the app. Off it
//   for a moment and the list shuts; while it is open the real cursor wins.
// - It shows only while something new waits on you and you are in another
//   app, over full-screen apps too; it hides for a while and comes back, is off
//   for good only in Settings, and goes when the app's window goes.
//
// What it drops: there is nothing to drag or place. It sits where the notch
// is, on the screen the pointer is on, at the notch's height.

import { hiddenUntil, newSince, notDismissed, readyNow, tagScaleOn, tagShows, tagZoom, toneFromLuma, zoomStep, HIDE_CHOICES } from '../shared/corner-tag.mjs';
import { displayUnder, islandAnchor, islandBounds, OPEN_WIDTH } from '../shared/notch-island.mjs';
import { CLOSE_AFTER_MS, OPEN_AFTER_MS, TONE_EVERY_MS } from './corner-tag.mjs';

export { CLOSE_AFTER_MS, OPEN_AFTER_MS };
// How long the page takes to shrink the island (notch-island.css); the window
// keeps the room until it has.
export const SETTLE_MS = 450;
// How often, while it is up and shut, it looks for the pointer on another screen.
export const SCREEN_EVERY_MS = 1000;
// How often the real cursor is read while the list is open.
const CURSOR_EVERY_MS = 200;

const HIDE_LABELS = { '5m': 'Hide for 5 minutes', '30m': 'Hide for 30 minutes', today: 'Hide for the rest of today' };
const CHANNELS = [
  'zero:corner-tag', 'notch-island:ready', 'notch-island:size', 'notch-island:shape', 'notch-island:hover', 'notch-island:clickable',
  'notch-island:go', 'notch-island:dismiss', 'notch-island:hide', 'notch-island:resize', 'notch-island:shut', 'notch-island:settings', 'notch-island:menu',
];
const MODES = ['shut', 'open'];

export function createNotchIsland({
  BrowserWindow, screen, ipcMain, Menu, powerMonitor, config, saveConfig, mainWindow, load, preload,
  // The notch on a display, by its id (main/liquid-glass.mjs, loadNotch).
  notch = () => null,
  // The Mac's own Liquid Glass (main/liquid-glass.mjs), or null, and then the
  // page draws the tray's own glass.
  glass = null,
  // What a notification has told you about since you were last at the app
  // (main/notify.mjs), counted as new the way the corner tag counts it.
  told = () => [],
  count = () => {}, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, mac = process.platform === 'darwin',
}) {
  let win = null;
  let loaded = false;
  let gone = false;
  let ready = [];
  let working = 0;
  // The same things the corner tag keeps, under the same names, so switching
  // between the two loses nothing.
  let lookedAt = Number(config.cornerTagLookedAt) || 0;
  const firstSeen = new Map();
  let dismissed = { ...(config.cornerTagDismissed ?? {}) };
  let zoom = tagZoom(config.cornerTagZoom);
  const toldNow = () => { try { return told() ?? []; } catch { return []; } };
  const fresh = () => readyNow(notDismissed(newSince(ready, lookedAt, toldNow()), dismissed), now());

  let mode = 'shut';
  // From the page: how wide the island gets, how tall it is in each mode, and
  // the shape it is drawn at right now, which the glass follows.
  let sizes = null;
  let shape = null;
  let anchor = null;
  let display = null;
  let hovered = false;
  let clickable = null;
  let tone = null;
  let toneFromScreen = false;
  let toneSent = null;
  const timers = { open: null, close: null, settle: null, screen: null, cursor: null, wake: null, tone: null };
  const stop = (k) => { if (timers[k]) { clearTimer(timers[k]); timers[k] = null; } };

  const alive = () => !!win && !win.isDestroyed();
  const visible = () => alive() && win.isVisible();
  const send = (channel, payload) => { if (alive() && loaded) win.webContents.send(channel, payload); };
  const inApp = () => {
    try { return !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused(); } catch { return false; }
  };
  const shouldShow = () => tagShows({
    on: config.cornerTag, hiddenUntil: config.cornerTagHiddenUntil ?? 0, now: now(), inApp: inApp(), ready: fresh().length,
  });

  const displays = () => { try { return screen.getAllDisplays() ?? []; } catch { return []; } };
  const cursor = () => { try { return screen.getCursorScreenPoint?.() ?? null; } catch { return null; } };
  // The screen it is on, or, when that one has gone, the one the pointer is on.
  const settle = () => {
    const all = displays();
    const d = all.find((x) => x.id === display?.id) ?? displayUnder(cursor(), all);
    if (!d) return;
    display = d;
    let n = null;
    try { n = notch(d.id); } catch { /* no reading: hung from the top edge */ }
    anchor = islandAnchor(d, n);
  };
  // The tray's own size for this screen and her multiple of it.
  const scaleNow = () => tagScaleOn((display?.workArea ?? display?.bounds)?.width ?? 0, zoom);

  const sendState = () => {
    const shown = fresh();
    send('notch-island:state', {
      ready: shown, before: Math.max(0, ready.length - shown.length), working, now: now(),
      mode, bar: anchor?.bar ?? 0, notch: anchor?.notch ?? 0, scale: scaleNow(), glass: !!glass,
    });
  };

  /* ------------------------- the Mac's own glass ------------------------- */
  // The island's top edge is the screen's, so the glass runs up past the
  // window by its own roundness: the top corners are cut off by the window
  // and only the bottom ones show round, the way the island is drawn.
  const dress = () => {
    if (!glass || !shape || !alive()) return;
    const r = shape.radius;
    const rect = { x: shape.x, y: shape.y - r, width: shape.width, height: shape.height + r };
    const opts = mode === 'shut' ? { radius: r, style: 'clear', ...(toneFromScreen ? { tone } : {}) } : tone ? { radius: r, tone } : { radius: r };
    try { glass.set(win, rect, opts); } catch { /* the page's own glass shows instead */ }
  };
  const shareTone = () => {
    if (!tone || !loaded || toneSent === tone) return;
    toneSent = tone;
    send('notch-island:tone', tone);
  };
  // Light or dark from how bright the screen behind it is, as the tag reads it.
  const readTone = () => {
    if (!glass || !shape || !visible()) return;
    let read = null;
    let fromLuma = false;
    try {
      read = toneFromLuma(glass.luma?.(win), tone);
      fromLuma = read !== null;
      if (!fromLuma && toneFromScreen) return;
      read ??= glass.tone(win);
    } catch { /* no reading, keep the last */ }
    if ((read !== 'light' && read !== 'dark') || (read === tone && fromLuma === toneFromScreen)) return;
    tone = read;
    toneFromScreen = fromLuma;
    dress();
    shareTone();
  };
  const watchTones = () => {
    if (!glass || timers.tone || gone) return;
    const tick = () => {
      timers.tone = null;
      if (gone || !visible()) return;
      readTone();
      timers.tone = setTimer(tick, TONE_EVERY_MS);
    };
    timers.tone = setTimer(tick, TONE_EVERY_MS);
  };

  const boundsFor = (m) => islandBounds(anchor, sizes?.width ?? OPEN_WIDTH, sizes?.[m] ?? anchor.bar);
  // Taller at once; shorter only once the page has had time to shrink it.
  const fit = () => {
    if (!alive() || !anchor) return;
    const want = boundsFor(mode);
    const have = win.getBounds();
    stop('settle');
    if (!have || have.x !== want.x || have.y !== want.y || have.width !== want.width || want.height >= have.height) {
      win.setBounds(want);
      return;
    }
    timers.settle = setTimer(() => {
      timers.settle = null;
      if (alive() && anchor) win.setBounds(boundsFor(mode));
    }, SETTLE_MS);
  };

  // The window first, then the page: growing, the room is there before the
  // shape moves into it.
  const setMode = (next) => {
    if (next !== 'open') { stop('close'); stop('cursor'); }
    mode = next;
    fit();
    sendState();
    dress();
    if (next === 'open') watchCursor();
  };

  const letClicksThrough = (on) => {
    if (!alive() || clickable === on) return;
    clickable = on;
    try { win.setIgnoreMouseEvents?.(!on, { forward: true }); } catch { /* an older Electron: the window takes every click */ }
  };

  /* --------------------- where the pointer really is ---------------------- */
  // Open, the window is the list, so its bounds are what the pointer is on.
  const within = (pt, r) => !!r && pt.x >= r.x && pt.x < r.x + r.width && pt.y >= r.y && pt.y < r.y + r.height;
  const readCursor = () => {
    const pt = cursor();
    if (pt && visible()) hovered = within(pt, win.getBounds());
  };

  function watchCursor() {
    if (timers.cursor || gone) return;
    const tick = () => {
      timers.cursor = null;
      if (gone || mode !== 'open') return;
      readCursor();
      reconsider();
      timers.cursor = setTimer(tick, CURSOR_EVERY_MS);
    };
    timers.cursor = setTimer(tick, CURSOR_EVERY_MS);
  }

  function reconsider() {
    if (mode !== 'open' || hovered) { stop('close'); return; }
    if (timers.close) return;
    timers.close = setTimer(() => {
      timers.close = null;
      readCursor();
      if (!hovered && mode === 'open') setMode('shut');
    }, CLOSE_AFTER_MS);
  }

  function meanToOpen() {
    if (mode === 'open' || timers.open) return;
    timers.open = setTimer(() => {
      timers.open = null;
      if (hovered && visible()) setMode('open');
    }, OPEN_AFTER_MS);
  }

  // The pointer goes to another screen: the island goes with it, unless its
  // list is open.
  function followScreen() {
    if (timers.screen || gone) return;
    const tick = () => {
      timers.screen = null;
      if (gone || !visible()) return;
      const pt = cursor();
      const d = pt && mode === 'shut' ? displayUnder(pt, displays()) : null;
      if (d && d.id !== display?.id) {
        display = d;
        settle();
        fit();
        sendState();
      }
      timers.screen = setTimer(tick, SCREEN_EVERY_MS);
    };
    timers.screen = setTimer(tick, SCREEN_EVERY_MS);
  }

  // Off the screen, everything goes back to where it starts, so it comes back shut.
  const putAway = () => {
    for (const k of ['open', 'close', 'settle', 'screen', 'cursor', 'tone']) stop(k);
    hovered = false;
    mode = 'shut';
    if (alive() && visible()) win.hide();
    letClicksThrough(false);
    sendState();
  };

  function refresh() {
    if (gone) return;
    stop('wake');
    const until = config.cornerTagHiddenUntil ?? 0;
    // A hide comes back by itself the moment it runs out.
    if (until > now()) timers.wake = setTimer(refresh, until - now() + 50);
    if (!shouldShow()) { putAway(); return; }
    if (!alive()) { make(); return; }
    if (!loaded) return;
    if (!visible()) {
      display = null;
      settle();
      setMode('shut');
      win.showInactive();
      followScreen();
      readTone();
      watchTones();
      return;
    }
    sendState();
  }

  const make = () => {
    win = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      roundedCorners: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: true,
      acceptFirstMouse: true,
      alwaysOnTop: true,
      // Its top edge is the screen's own, over the menu bar, where a window
      // is otherwise pushed down out of the way.
      enableLargerThanScreen: true,
      ...(mac ? { type: 'panel' } : {}),
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    // Above the menu bar, which it sits in.
    win.setAlwaysOnTop(true, 'status');
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); } catch {}
    loaded = false;
    clickable = null;
    toneSent = null;
    letClicksThrough(false);
    win.on('closed', () => { win = null; loaded = false; clickable = null; });
    win.webContents.on('did-finish-load', () => { try { win?.webContents.setZoomFactor?.(1); } catch { /* measured in points anyway */ } });
    // A reload starts the handshake again; until the page says it is ready
    // nothing is sent to it and it is not shown. The first load is not one.
    win.webContents.on('did-start-loading', () => {
      if (!loaded) return;
      putAway();
      loaded = false;
      toneSent = null;
    });
    settle();
    fit();
    load(win);
  };

  const bringAppForward = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return true;
  };

  // Into the app: on a thread when a line was picked, or the app as it is.
  function goTo(id) {
    setMode('shut');
    if (!bringAppForward()) return;
    if (typeof id === 'string' && id) mainWindow.webContents.send('zero:open-item', { id });
  }

  const hide = (choice) => {
    const until = hiddenUntil(choice, now());
    if (!until) return;
    saveConfig(config, { cornerTagHiddenUntil: until });
    count('tag_hidden', { seconds: Math.round((until - now()) / 1000) });
    refresh();
  };

  const openSettings = () => {
    setMode('shut');
    if (bringAppForward()) mainWindow.webContents.send('zero:open-settings', { pane: 'general' });
  };

  const setZoom = (next) => {
    zoom = tagZoom(next);
    saveConfig(config, { cornerTagZoom: zoom });
    sendState();
  };

  /* ------------------------------ from the app's page ---------------------- */
  ipcMain.handle('zero:corner-tag', (_e, state) => {
    const given = Array.isArray(state?.ready) ? state.ready : [];
    const ids = new Set(given.map((r) => r.id));
    for (const id of firstSeen.keys()) if (!ids.has(id)) firstSeen.delete(id);
    ready = given.map((r) => {
      if (Number.isFinite(r.since)) return r;
      if (!firstSeen.has(r.id)) firstSeen.set(r.id, now());
      return { ...r, since: firstSeen.get(r.id) };
    });
    working = Number.isFinite(state?.working) ? state.working : 0;
    const kept = Object.fromEntries(Object.entries(dismissed).filter(([id]) => ids.has(id)));
    if (Object.keys(kept).length !== Object.keys(dismissed).length) {
      dismissed = kept;
      try { saveConfig(config, { cornerTagDismissed: dismissed }); } catch { /* kept for this run only */ }
    }
    refresh();
    return null;
  });

  /* ------------------------------ from the island's page ------------------- */
  ipcMain.handle('notch-island:ready', () => {
    loaded = true;
    shareTone();
    refresh();
    return null;
  });

  // { width, shut, open }: how wide the island gets, and how tall it is in
  // each of its sizes, in points.
  ipcMain.handle('notch-island:size', (_e, p) => {
    if (!(p?.width > 0) || !MODES.every((m) => p[m] > 0)) return null;
    sizes = { width: Math.ceil(p.width), ...Object.fromEntries(MODES.map((m) => [m, Math.ceil(p[m])])) };
    fit();
    return null;
  });

  // { x, y, width, height, radius }: where the island is drawn in the window
  // right now, in points, on every frame it moves.
  ipcMain.handle('notch-island:shape', (_e, p) => {
    if (!(p?.width > 0) || !(p?.height > 0) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    shape = { x: p.x, y: p.y, width: p.width, height: p.height, radius: Number.isFinite(p.radius) && p.radius >= 0 ? p.radius : 0 };
    dress();
    return null;
  });

  ipcMain.handle('notch-island:hover', (_e, p) => {
    hovered = !!p?.inside;
    if (hovered) meanToOpen();
    else stop('open');
    reconsider();
    return null;
  });

  ipcMain.handle('notch-island:clickable', (_e, p) => { letClicksThrough(!!p?.on); return null; });
  ipcMain.handle('notch-island:go', (_e, id) => { goTo(id); return null; });
  // The X on a line: off the island, and only the island.
  ipcMain.handle('notch-island:dismiss', (_e, id) => {
    if (typeof id !== 'string' || !fresh().some((r) => r.id === id)) return null;
    dismissed = { ...dismissed, [id]: now() };
    try { saveConfig(config, { cornerTagDismissed: dismissed }); } catch { /* kept for this run only */ }
    refresh();
    return null;
  });
  ipcMain.handle('notch-island:hide', (_e, choice) => { hide(choice); return null; });
  // A notch bigger or smaller, from the list's foot, as on the corner tag.
  ipcMain.handle('notch-island:resize', (_e, p) => { setZoom(zoomStep(zoom, Number(p?.by) < 0 ? -1 : 1)); return null; });
  // Escape.
  ipcMain.handle('notch-island:shut', () => { if (mode !== 'shut') setMode('shut'); return null; });
  ipcMain.handle('notch-island:settings', () => { openSettings(); return null; });
  ipcMain.handle('notch-island:menu', () => {
    if (!alive()) return null;
    setMode('shut');
    Menu.buildFromTemplate([
      { label: 'Bigger', click: () => setZoom(zoomStep(zoom, 1)) },
      { label: 'Smaller', click: () => setZoom(zoomStep(zoom, -1)) },
      { label: 'Size for this screen', enabled: zoom !== 1, click: () => setZoom(1) },
      { type: 'separator' },
      ...HIDE_CHOICES.map((c) => ({ label: HIDE_LABELS[c.key], click: () => hide(c.key) })),
      { type: 'separator' },
      { label: 'Turn off in Settings…', click: openSettings },
    ]).popup({ window: win });
    return null;
  });

  /* ------------------------------ from the system -------------------------- */
  // A screen came, went or changed: back to the notch, wherever it now is.
  const reseat = () => {
    if (gone) return;
    if (mode === 'open') setMode('shut');
    settle();
    fit();
    sendState();
  };
  const woke = () => { reseat(); refresh(); };

  const onFocus = () => { lookedAt = now(); refresh(); };
  const onBlur = () => {
    lookedAt = now();
    try { saveConfig(config, { cornerTagLookedAt: lookedAt }); } catch { /* kept for this run only */ }
    refresh();
  };
  const dispose = () => {
    if (gone) return;
    gone = true;
    for (const k of Object.keys(timers)) stop(k);
    if (alive()) win.destroy();
    for (const ch of CHANNELS) { try { ipcMain.removeHandler?.(ch); } catch {} }
    try {
      screen.removeListener?.('display-added', reseat);
      screen.removeListener?.('display-removed', reseat);
      screen.removeListener?.('display-metrics-changed', reseat);
      powerMonitor?.removeListener?.('resume', woke);
      powerMonitor?.removeListener?.('unlock-screen', woke);
    } catch {}
  };

  if (mainWindow) {
    mainWindow.on('focus', onFocus);
    mainWindow.on('blur', onBlur);
    mainWindow.on('closed', dispose);
  }
  try {
    screen.on('display-added', reseat);
    screen.on('display-removed', reseat);
    screen.on('display-metrics-changed', reseat);
  } catch {}
  try { powerMonitor?.on?.('resume', woke); powerMonitor?.on?.('unlock-screen', woke); } catch {}

  return {
    refresh,
    dispose,
    // Tests, and nothing else.
    _state: () => ({ ready: fresh(), working, mode, anchor, tone, visible: visible(), bounds: alive() ? win.getBounds() : null }),
  };
}
