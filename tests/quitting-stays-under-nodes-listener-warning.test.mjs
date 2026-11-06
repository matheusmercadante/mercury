// The first boot with meetings wrote MaxListenersExceededWarning to the log: the
// app's before-quit listeners went from 10 to 11, and Node warns past 10. Each
// `quitStep` is one listener, so a thing that needs no tidying at quit, like a
// timer that is already unref'd, should not take one.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const count = (file, pattern) => (fs.readFileSync(file, 'utf8').match(pattern) ?? []).length;

describe('the app quitting', () => {
  it('has no more before-quit listeners than Node allows without a warning', () => {
    const steps = count('main/main.mts', /quitStep\(app, 'before-quit'/g);
    const bare = count('main/main.mts', /app\.on\('before-quit'/g) + count('main/ipc.mts', /app\.on\('before-quit'/g);
    expect(steps + bare).toBeLessThanOrEqual(10);
  });
});
