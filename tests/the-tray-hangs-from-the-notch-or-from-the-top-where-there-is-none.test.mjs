// THE ISLAND (w-2a3136a92a). The corner tag was hard to see, so on a Mac the
// tray became an island in the notch: black, centred on the camera, the
// notch's own height. A screen with no notch gets the same island hung from the
// middle of its top edge at the menu bar's height. Without these rules it would
// sit off-centre from the camera, or float under the menu bar on an external
// screen, or show off the same thread every time it came back.
//
// Measured on the shapes that matter: a 14" MacBook Pro's notch (about 186 x
// 38 points at its default size, a stand-in: the real one is read from macOS
// at run time) and the 27" Dell beside it, which macOS gave a 30-point menu
// bar and no notch when read on 2026-11-01.
import { describe, expect, it } from 'vitest';
import { BAR_FALLBACK, displayUnder, islandAnchor, islandBounds, peekFor } from '../shared/notch-island.mjs';
import { DELL, LAPTOP, LAPTOP_NOTCH } from './helpers/notch-island-rig.mjs';

describe('where the island hangs', () => {
  it('is centred on the notch, at the notch\'s height, flush with the top of the screen', () => {
    expect(islandAnchor(LAPTOP, LAPTOP_NOTCH)).toEqual({ centerX: 756, top: 0, bar: 38, notch: 186 });
  });

  it('hangs from the middle of the top edge at the menu bar\'s height on a screen without one', () => {
    expect(islandAnchor(DELL, null)).toEqual({ centerX: 2472, top: -200, bar: 30, notch: 0 });
  });

  it('takes a reading of no width as no notch', () => {
    expect(islandAnchor(LAPTOP, { x: 756, width: 0, height: 38 }).notch).toBe(0);
    expect(islandAnchor(LAPTOP, { x: 663, width: 186, height: 0 }).centerX).toBe(756);
  });

  it('is the usual height where the menu bar hides itself or says something odd', () => {
    const hidden = { ...DELL, workArea: { ...DELL.bounds } };
    expect(islandAnchor(hidden, null).bar).toBe(BAR_FALLBACK);
    expect(islandAnchor({ ...DELL, workArea: { ...DELL.workArea, y: DELL.bounds.y + 120 } }, null).bar).toBe(BAR_FALLBACK);
    expect(islandAnchor({ bounds: DELL.bounds }, null).bar).toBe(BAR_FALLBACK);
  });

  it('puts the window\'s middle on that point, in whole points', () => {
    const anchor = islandAnchor(LAPTOP, LAPTOP_NOTCH);
    expect(islandBounds(anchor, 500, 38)).toEqual({ x: 506, y: 0, width: 500, height: 38 });
    expect(islandBounds(anchor, 499.4, 90.6)).toEqual({ x: 507, y: 0, width: 499, height: 91 });
  });
});

describe('which screen it is on', () => {
  it('is the one the pointer is on', () => {
    expect(displayUnder({ x: 2000, y: 100 }, [LAPTOP, DELL])).toBe(DELL);
    expect(displayUnder({ x: 10, y: 10 }, [LAPTOP, DELL])).toBe(LAPTOP);
  });

  it('counts the very edge of a screen as that screen and not the next', () => {
    expect(displayUnder({ x: 1511, y: 10 }, [LAPTOP, DELL])).toBe(LAPTOP);
    expect(displayUnder({ x: 1512, y: 10 }, [LAPTOP, DELL])).toBe(DELL);
  });

  it('falls back to the first screen with no pointer, or a pointer between screens', () => {
    expect(displayUnder(null, [LAPTOP, DELL])).toBe(LAPTOP);
    expect(displayUnder({ x: 1000, y: 2000 }, [LAPTOP, DELL])).toBe(LAPTOP);
    expect(displayUnder({ x: 0, y: 0 }, [])).toBe(null);
  });
});

describe('what it grows to show', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  const c = { id: 'c' };

  it('shows the newest arrival, which comes first', () => {
    expect(peekFor([], [a])).toBe(a);
    expect(peekFor([a], [b, a])).toBe(b);
    expect(peekFor([a], [c, b, a])).toBe(c);
  });

  it('shows nothing when threads only left, or nothing changed', () => {
    expect(peekFor([a, b], [a])).toBe(null);
    expect(peekFor([a], [a])).toBe(null);
    expect(peekFor([a], [])).toBe(null);
  });

  it('copes with nothing before or after', () => {
    expect(peekFor(null, [a])).toBe(a);
    expect(peekFor([a], null)).toBe(null);
  });
});
