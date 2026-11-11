// A PROJECT'S OWN BROWSER, ON THE PROJECT'S PAGE: the sites its agents may
// open, and the window its owner signs in through. A project with no site
// listed has no browser, so the list is also the switch.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ProjectBrowser, ProjectSettings, Settings as SettingsModel } from '../types';
import { SIGN_IN_LABEL, SITES_LABEL, signInButton, signInLine, sitesLine } from '../project-browser-words';

const WATCH_MS = 2_000;

export function ProjectBrowserRows({ project, onSaved }: { project: ProjectSettings; onSaved: (settings: SettingsModel) => void }) {
  const sites = project.browserSites ?? [];
  const listed = sites.join(', ');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(listed);
  const [said, setSaid] = useState<string | null>(null);
  const [browser, setBrowser] = useState<ProjectBrowser | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setEditing(false); setSaid(null); setBrowser(null); }, [project.slug]);

  const look = useCallback(async () => setBrowser(await api.projectBrowser({ product: project.slug })), [project.slug]);
  useEffect(() => { if (listed) void look(); }, [listed, look]);
  // The window is closed in the browser, not here, so its closing is watched for.
  useEffect(() => {
    if (browser?.state !== 'signing-in') return undefined;
    const watch = window.setInterval(() => void look(), WATCH_MS);
    return () => window.clearInterval(watch);
  }, [browser?.state, look]);

  const save = async () => {
    const out = await api.setProjectSetting({ product: project.slug, key: 'browserSites', value: draft });
    if (!out.ok) { setSaid(out.error ?? 'Could not save that.'); return; }
    setEditing(false);
    setSaid(null);
    onSaved(out);
  };

  const press = async (action: 'sign-in' | 'done') => {
    setBusy(true);
    try { setBrowser(await api.projectBrowser({ product: project.slug, action })); } finally { setBusy(false); }
  };

  const button = signInButton(browser, busy);
  return (
    <>
      {editing ? (
        <form className="set-row set-key-replace" aria-label={SITES_LABEL} onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <span className="set-key-name">{SITES_LABEL}</span>
          <input
            className="set-key-input"
            type="text"
            aria-label={SITES_LABEL}
            placeholder="acme.atlassian.net, grafana.acme.dev"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setSaid(null); }}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); setSaid(null); } }}
          />
          <span className="set-row-ctl">
            <button type="submit" className="set-ghost" disabled={draft.trim() === listed}>Save</button>
            <button type="button" className="set-ghost" onClick={() => { setEditing(false); setSaid(null); }}>Cancel</button>
          </span>
          {said && <span className="set-key-said">{said}</span>}
        </form>
      ) : (
        <div className="set-row">
          <div className="set-row-text">
            <div className="set-row-label">{SITES_LABEL}</div>
            <div className="set-row-desc">{sitesLine(sites)}</div>
          </div>
          <div className="set-row-ctl">
            <button type="button" className="set-ghost" onClick={() => { setDraft(listed); setEditing(true); }}>{sites.length ? 'Change' : 'Add a site'}</button>
          </div>
        </div>
      )}
      {sites.length > 0 && (
        <div className="set-row">
          <div className="set-row-text">
            <div className="set-row-label">{SIGN_IN_LABEL}</div>
            <div className="set-row-desc">{signInLine(browser, busy)}</div>
          </div>
          <div className="set-row-ctl">
            <button type="button" className="set-ghost" disabled={button.disabled} onClick={() => void press(button.action)}>{button.label}</button>
          </div>
        </div>
      )}
    </>
  );
}
