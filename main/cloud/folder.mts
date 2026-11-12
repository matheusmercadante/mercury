// THE FOLDER A MAC'S CLOUD FILES ARE KEPT IN: the app's own, never Agentbox's
// (CLAUDE.md). On its own, so the hub's client can name it without loading
// the rest of the cloud code.
import os from 'node:os';
import path from 'node:path';
import { nameSlug } from '../../shared/product-name.mjs';

export const cloudFolder = (home: string = os.homedir()): string => path.join(home || os.homedir(), `.${nameSlug}`);
