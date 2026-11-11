// A PROJECT'S BROWSER OPENS ONLY THE SITES ITS OWNER LISTED.
//
// Why this exists (2026-11-10): agents got a browser per project that holds
// the sign-ins its owner made in it. An agent that can open any address can
// carry what it read on a signed-in page to any address, so the list of sites
// is what bounds it. A list matched by "ends with" lets `evil-atlassian.net`
// pass for `atlassian.net`, and a list that keeps `com` lets everything pass.
import { describe, it, expect } from 'vitest';
import { AGENT_TOOLS, cleanSites, notOneOfItsSites, siteAllows, siteOf, sitesOfProject } from '../shared/project-browser.mts';

describe('a site as the person typed it', () => {
  it('is kept as its host, whether typed as a host or pasted as an address', () => {
    expect(siteOf('acme.atlassian.net')).toBe('acme.atlassian.net');
    expect(siteOf('https://acme.atlassian.net/jira/software/projects/OMS/boards/1?x=1')).toBe('acme.atlassian.net');
    expect(siteOf('  HTTP://Example.COM:8443/  ')).toBe('example.com');
    expect(siteOf('localhost:3000')).toBe('localhost');
  });

  it('drops a leading www, so the site and its other hosts are one entry', () => {
    expect(siteOf('www.example.com')).toBe('example.com');
    expect(siteOf('https://www.example.com/pricing')).toBe('example.com');
  });

  it('is refused when it names no site, or every site', () => {
    for (const typed of ['', '   ', 'com', 'net', '*', '*.example.com', 'exa mple.com', 'file:///etc/passwd', 'javascript:alert(1)', null, undefined, 7]) {
      expect(siteOf(typed), String(typed)).toBeNull();
    }
  });
});

describe('the list a project keeps', () => {
  it('takes a list or one line of text, and keeps each site once', () => {
    expect(cleanSites(['acme.atlassian.net', 'https://ACME.atlassian.net/x', 'grafana.acme.dev'])).toEqual(['acme.atlassian.net', 'grafana.acme.dev']);
    expect(cleanSites('acme.atlassian.net, grafana.acme.dev\nhttps://app.acme.dev/login')).toEqual(['acme.atlassian.net', 'grafana.acme.dev', 'app.acme.dev']);
  });

  it('drops what is not a site and anything that is not a list', () => {
    expect(cleanSites(['com', 'acme.dev', '', null])).toEqual(['acme.dev']);
    expect(cleanSites(undefined)).toEqual([]);
    expect(cleanSites({ a: 'acme.dev' })).toEqual([]);
  });

  it('is read per project from the config, and is empty for a project with none', () => {
    const config = { projectBrowserSites: { oms: ['acme.atlassian.net'], broken: 'acme.dev' as unknown as string[] } };
    expect(sitesOfProject(config, 'oms')).toEqual(['acme.atlassian.net']);
    expect(sitesOfProject(config, 'other')).toEqual([]);
    expect(sitesOfProject(config, 'broken')).toEqual([]);
    expect(sitesOfProject({}, 'oms')).toEqual([]);
    expect(sitesOfProject(null, 'oms')).toEqual([]);
  });
});

describe('which addresses a project\'s browser opens', () => {
  const sites = ['acme.atlassian.net', 'acme.dev'];

  it('opens a listed site and the hosts under it', () => {
    expect(siteAllows(sites, 'https://acme.atlassian.net/browse/OMS-1')).toBe(true);
    expect(siteAllows(sites, 'https://app.acme.dev/')).toBe(true);
    expect(siteAllows(sites, 'http://acme.dev:8080/x')).toBe(true);
  });

  it('refuses a host that only looks like one', () => {
    expect(siteAllows(sites, 'https://evil-acme.dev/')).toBe(false);
    expect(siteAllows(sites, 'https://acme.dev.evil.com/')).toBe(false);
    expect(siteAllows(sites, 'https://atlassian.net/')).toBe(false);
    expect(siteAllows(sites, 'https://other.atlassian.net/')).toBe(false);
    expect(siteAllows(sites, 'https://acme.dev@evil.com/')).toBe(false);
  });

  it('refuses anything that is not a web address', () => {
    for (const url of ['file:///Users/x/.ssh/id_rsa', 'chrome://settings', 'javascript:alert(1)', 'about:blank', 'data:text/html,hi', 'not a url', '']) {
      expect(siteAllows(sites, url), url).toBe(false);
    }
  });

  it('opens nothing when the project lists nothing', () => {
    expect(siteAllows([], 'https://acme.dev/')).toBe(false);
  });

  it('says which sites it does open when it refuses one', () => {
    const said = notOneOfItsSites('https://github.com/acme', sites);
    expect(said).toContain('github.com');
    expect(said).toContain('acme.atlassian.net');
    expect(said).toContain('acme.dev');
  });
});

describe('the tools an agent is given on it', () => {
  it('can read, move about and fill in a page', () => {
    for (const tool of ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_take_screenshot', 'browser_tabs']) {
      expect(AGENT_TOOLS).toContain(tool);
    }
  });

  it('cannot run code in the page or in the browser, or send a file', () => {
    for (const tool of ['browser_evaluate', 'browser_run_code_unsafe', 'browser_file_upload', 'browser_drop', 'browser_network_request']) {
      expect(AGENT_TOOLS).not.toContain(tool);
    }
  });
});
