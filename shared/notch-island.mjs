// THE ISLAND (w-2a3136a92a): the Agent Tray drawn into the Mac's notch, the
// rules and nothing that touches a window.
//
// The corner tag was too easy to miss. The island says the same thing in the
// one place a Mac's eye already goes: black, flush with the notch, the mark on
// one side of the camera and how many are waiting on the other. On a screen
// with no notch it hangs from the middle of the top edge, the height of the
// menu bar, the way a notch would.
//
// What it counts, when it shows, how it hides and how you turn it off are the
// corner tag's rules (shared/corner-tag.mjs), unchanged. main/notch-island.mjs
// owns the window and renderer/src/notch-island the page.

/** How long the island stays grown to show what just arrived. */
export const PEEK_MS = 4000;

/** The bar's height on a screen whose menu bar does not say: one that hides itself. */
export const BAR_FALLBACK = 30;

/** How wide the island opens, and how wide it grows to show an arrival. */
export const OPEN_WIDTH = 440;

/**
 * Where the island hangs on this display: the middle of its notch, or of its
 * top edge on a screen without one, and how tall the bar it fills is.
 * `notch` is { x, width, height } in points from the screen's top left
 * (main/liquid-glass.mjs, loadNotch), or null.
 */
export function islandAnchor(display, notch) {
  const b = display.bounds;
  if (notch && notch.width > 0 && notch.height > 0) {
    return { centerX: b.x + notch.x + notch.width / 2, top: b.y, bar: Math.round(notch.height), notch: Math.round(notch.width) };
  }
  const menu = display.workArea ? display.workArea.y - b.y : 0;
  return { centerX: b.x + b.width / 2, top: b.y, bar: menu >= 20 && menu <= 48 ? menu : BAR_FALLBACK, notch: 0 };
}

/** The window: this wide and this tall, hanging from the anchor. */
export function islandBounds(anchor, width, height) {
  const w = Math.round(width);
  return { x: Math.round(anchor.centerX - w / 2), y: anchor.top, width: w, height: Math.round(height) };
}

/**
 * The display the pointer is on, which is where you are looking, or the first
 * one when there is no pointer to go by.
 */
export function displayUnder(point, displays) {
  const list = displays ?? [];
  if (point) {
    const hit = list.find(({ bounds: b }) => point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + b.height);
    if (hit) return hit;
  }
  return list[0] ?? null;
}

/**
 * What the island grows to show: the newest thread that was not on it the last
 * time it was up. `after` is newest first (shared/corner-tag.mjs, readyNow).
 * Nothing when threads only left it, so answering three does not flash three
 * times.
 */
export function peekFor(before, after) {
  const was = new Set((before ?? []).map((r) => r.id));
  return (after ?? []).find((r) => !was.has(r.id)) ?? null;
}
