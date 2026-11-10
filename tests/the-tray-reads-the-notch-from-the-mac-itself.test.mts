// WHERE THE NOTCH IS (w-2a3136a92a). Electron says nothing about the notch, and
// its width in points changes with the screen's scaled size, so the tray asks
// macOS: the two parts of the menu bar either side of the camera (NSScreen's
// auxiliaryTopLeftArea and auxiliaryTopRightArea, macOS 12), read by
// main/native/liquid-glass. Without that reading the island could not be
// centred on the camera. Measured on 2026-11-01: Electron's display id is the
// screen's NSScreenNumber (3 for the external screen, both ways), and the
// built binary answers null for that screen, which has no notch.
//
// Every way the reading can be missing has to leave the island hanging from
// the middle of the top edge rather than breaking it: not a Mac, no binary, an
// older binary built before it could read the notch, or a reading that throws.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNotch } from '../main/liquid-glass.mts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('the notch reading', () => {
  it('asks the binary about the display by its id', () => {
    const asked = [];
    const notch = loadNotch({ mac: true, load: () => ({ notch: (id) => { asked.push(id); return id === 1 ? { x: 663, width: 186, height: 38 } : null; } }) });
    expect(notch(1)).toEqual({ x: 663, width: 186, height: 38 });
    expect(notch(3)).toBe(null);
    expect(asked).toEqual([1, 3]);
  });

  it('is never there off a Mac, without the binary, or with a binary that cannot read it', () => {
    const native = { notch: () => ({ x: 1, width: 1, height: 1 }) };
    expect(loadNotch({ mac: false, load: () => native })(1)).toBe(null);
    expect(loadNotch({ mac: true, load: () => { throw new Error('Cannot find module'); } })(1)).toBe(null);
    expect(loadNotch({ mac: true, load: () => ({ available: () => true }) })(1)).toBe(null);
  });

  it('is not there when the reading throws or says nothing', () => {
    expect(loadNotch({ mac: true, load: () => ({ notch: () => { throw new Error('no screen'); } }) })(1)).toBe(null);
    expect(loadNotch({ mac: true, load: () => ({ notch: () => undefined }) })(1)).toBe(null);
  });

  it('does not need the Mac\'s glass to be there', () => {
    const notch = loadNotch({ mac: true, load: () => ({ available: () => false, notch: () => ({ x: 663, width: 186, height: 38 }) }) });
    expect(notch(1)).toEqual({ x: 663, width: 186, height: 38 });
  });

  it('is read from the two parts of the menu bar either side of the camera', () => {
    const source = fs.readFileSync(path.join(root, 'main/native/liquid-glass/liquid-glass.mm'), 'utf8');
    expect(source).toMatch(/auxiliaryTopLeftArea/);
    expect(source).toMatch(/auxiliaryTopRightArea/);
    expect(source).toMatch(/NSScreenNumber/);
    expect(source).toMatch(/\{ "notch", nullptr, Notch,/);
  });
});
