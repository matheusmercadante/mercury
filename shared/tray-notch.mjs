// THE TRAY UNDER THE NOTCH (w-2a3136a92a): where the corner tag sits on a Mac,
// the rules and nothing that touches a window.
//
// In a corner the tray was too easy to miss. On a Mac it sits centred just
// under the notch of the screen you are on, the one place the eye already
// goes, or under the middle of the menu bar on a screen without a notch. It is
// the same tray: its glass, its list, its rules (shared/corner-tag.mjs).
// main/corner-tag.mjs places the windows from these.

/** Space between the bottom of the notch (or the menu bar) and the tray's glass. */
export const NOTCH_GAP = 6;

/** The bar's height on a screen whose menu bar does not say: one that hides itself. */
export const BAR_FALLBACK = 30;

/** Space between the tray and the list that opens under it, as in a corner. */
export const LIST_GAP = 8;

/**
 * The middle of the notch on this display, or of its top edge on a screen
 * without one, and how tall the strip is that the tray sits under.
 * `notch` is { x, width, height } in points from the screen's top left
 * (main/liquid-glass.mjs, loadNotch), or null.
 */
export function notchAnchor(display, notch) {
  const b = display.bounds;
  if (notch && notch.width > 0 && notch.height > 0) {
    return { centerX: b.x + notch.x + notch.width / 2, top: b.y, bar: Math.round(notch.height), notch: Math.round(notch.width) };
  }
  const menu = display.workArea ? display.workArea.y - b.y : 0;
  return { centerX: b.x + b.width / 2, top: b.y, bar: menu >= 20 && menu <= 48 ? menu : BAR_FALLBACK, notch: 0 };
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
 * The tray window's top left, so the GLASS inside it (`glass`, its rectangle
 * within the window) is centred under the anchor, the gap below the strip.
 */
export function underNotch(anchor, glass) {
  return { x: anchor.centerX - (glass.x + glass.width / 2), y: anchor.top + anchor.bar + NOTCH_GAP - glass.y };
}

/** The list under a tray that sits in the middle: centred on it, kept on the screen. */
export function listUnder(glass, card, area) {
  const middle = glass.x + glass.width / 2;
  const x = Math.max(area.x, Math.min(middle - card.width / 2, area.x + area.width - card.width));
  return { x, y: glass.y + glass.height + LIST_GAP, width: card.width, height: card.height };
}
