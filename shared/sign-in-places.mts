// WHERE A SIGN-IN LIVES ON THIS COMPUTER, which never goes to the cloud,
// whoever asks and whatever the person presses: a file sent to a cloud thread
// (./cloud-sent-files.mts) and a key a cloud run asks for (./cloud-key-sources.mts).
// No fs here: the renderer reads it to decide which press a card offers.
import { nameSlug, WAS } from './product-name.mjs';

const FOLDERS = /(^|\/)(\.ssh|\.aws|\.gnupg|\.netrc|\.npmrc|\.pypirc|\.docker|\.kube|\.claude[^/]*|\.codex|\.agentbox|Keychains|\.config\/gh|\.config\/gcloud|\.password-store)(\/|$)/;

// MERCURY: this copy's own home is ~/.<its name> (main/store/home.mts appHome),
// and it holds the cloud key and cloud sign-ins (cloud-key, cloud-logins.json)
// just as ~/.agentbox does for Agentbox. Older names' folders still answer there,
// so they are refused too.
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const APP_HOMES = new RegExp(`(^|/)\\.(${[nameSlug, ...WAS.map((w: string) => w.toLowerCase())].map(escaped).join('|')})(/|$)`, 'i');

// Claude Code's login ("Claude Code-credentials", one per sign-in folder),
// Codex's, and the keys that unlock a browser's or this app's saved sign-ins.
const KEYCHAIN_ITEMS = /^(claude code\b|codex\b)|\bsafe storage$/i;

export const SIGN_IN_REFUSED = 'That holds sign-ins, so it never goes to the cloud.';

export const pathHoldsSignIns = (p: string): boolean => FOLDERS.test(p) || APP_HOMES.test(p);

export const keychainItemHoldsSignIns = (item: string): boolean => KEYCHAIN_ITEMS.test(item.trim());
