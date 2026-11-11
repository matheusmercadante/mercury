// A PROJECT'S OWN BROWSER: the rules every side reads. The app, the browser's
// host and the settings page all ask here which sites a project lists and
// whether an address is one of them.
//
// The browser holds the sign-ins its owner made in it for that one project, and
// nothing of the browser they use themselves. What bounds an agent on it is the
// list of sites: an agent that could open any address could carry what it read
// on a signed-in page to any address.

/** The tool server's name, so its tools read `mcp__project-browser__…`. */
export const BROWSER_SERVER = 'project-browser';

const MOST_SITES = 20;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** What the person typed as one site, kept as its host, or null when it names none. */
export function siteOf(typed: unknown): string | null {
  if (typeof typed !== 'string') return null;
  const text = typed.trim().toLowerCase();
  if (!text || /\s/.test(text)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(text);
  if (!hasScheme && /^[a-z][a-z0-9+.-]*:(?!\d)/.test(text)) return null;
  let url: URL;
  try { url = new URL(hasScheme ? text : `https://${text}`); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\./, '');
  if (!HOST.test(host)) return null;
  // One label is a whole top-level domain, which would list every site under it.
  if (!host.includes('.') && host !== 'localhost') return null;
  return host;
}

/** A project's list as it is kept: each site once, in the order given. */
export function cleanSites(list: unknown): string[] {
  const typed = typeof list === 'string' ? list.split(/[\s,;]+/) : Array.isArray(list) ? list : [];
  const sites: string[] = [];
  for (const one of typed) {
    const site = siteOf(one);
    if (site && !sites.includes(site)) sites.push(site);
  }
  return sites.slice(0, MOST_SITES);
}

/** The sites a project's browser opens, from the app's config. None means the project has no browser. */
export function sitesOfProject(config: { projectBrowserSites?: Record<string, unknown> | null } | null | undefined, slug: string): string[] {
  const kept = config?.projectBrowserSites?.[slug];
  return Array.isArray(kept) ? cleanSites(kept) : [];
}

/** Whether a project's browser opens this address: a web address on a listed site or a host under one. */
export function siteAllows(sites: readonly string[], address: unknown): boolean {
  let url: URL;
  try { url = new URL(String(address ?? '')); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return sites.some((site) => host === site || host.endsWith(`.${site}`));
}

const hostOf = (address: unknown): string => { try { return new URL(String(address)).hostname || String(address); } catch { return String(address); } };

export const notOneOfItsSites = (address: unknown, sites: readonly string[]): string =>
  `${hostOf(address)} is not one of this project's sites, so it was not opened. This browser opens ${sites.join(', ')} and nothing else. If the work needs another site, say so in your message: the owner adds it under Settings, Projects, this project, Browser.`;

export const SIGNING_IN = 'The owner has this project\'s browser open to sign in, so it cannot be used right now and nothing was done. Try again in a minute.';

export const NO_TEST_BROWSER = 'This computer has no Chrome for Testing for the project\'s browser to run on, so nothing was opened. Tell the owner: pressing Sign in under Settings, Projects, this project, Browser downloads it.';

// Playwright MCP's own names. Reading, moving about and filling in a page are
// here. Running code in the page or in the browser, sending files and reading
// raw network traffic are not: each is a way round the list of sites.
export const AGENT_TOOLS: readonly string[] = [
  'browser_navigate',
  'browser_navigate_back',
  'browser_snapshot',
  'browser_find',
  'browser_take_screenshot',
  'browser_click',
  'browser_hover',
  'browser_type',
  'browser_press_key',
  'browser_select_option',
  'browser_fill_form',
  'browser_handle_dialog',
  'browser_tabs',
  'browser_wait_for',
  'browser_close',
];

/** What a run on a project with a browser is told about it. */
export function browserBrief(sites: readonly string[]): string | null {
  if (!sites.length) return null;
  return [
    '## This project\'s browser',
    `This project has a browser of its own, which you drive with the ${BROWSER_SERVER} tools. The owner signed it in by hand, and it opens these sites and nothing else: ${sites.join(', ')}. The project's other threads use the same browser at the same time, each in its own tabs.`,
    'Use it to read. You are signed in as the owner there, so anything you submit, post, change or delete is done in their name: do that only when this task asks for it in so many words.',
    'A page that asks you to sign in, or for a code, means the sign-in has ended. Do not try to sign in. Stop, and tell the owner which site it was and that they sign in again under Settings, Projects, this project, Browser.',
    'After a page opens or changes you are given a link to a file with what is on it. Read that file, or search it, rather than taking a screenshot.',
  ].join('\n');
}
