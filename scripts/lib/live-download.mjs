// What the website's download is serving right now, read from
// `gh release view --json tagName,assets` on the release repo.
//
// Two answers that must never be confused (2026-10-05, the first agentbox.ac
// build): null means the output could not be read, and publishing has to stop.
// A release that simply has no download file on it is a live release serving
// nothing, `missing: true`, and publishing is exactly what fixes that.


import { Name } from '../../shared/product-name.mjs';

// THE ONE PUBLIC REPO the website downloads from and installed copies update
// from (2026-10-05). It replaced Astral-Agent/astral-releases, which is private,
// so its files 404 for everyone signed out of GitHub, and whose older releases
// carried personal details. package.json build.publish must name the same repo;
// tests/the-download-lives-in-a-public-release-repo checks they agree.
// Mercury's is the fork itself; Agentbox's would install Agentbox over it.
export const RELEASE_REPO = 'matheusmercadante/mercury';
export const DOWNLOAD_ASSET = `${Name}.dmg`;

// A repo with no release at all yet: gh says exactly this. Nothing is served,
// and publishing is what fixes it. Any other gh failure still stops.
export function noReleaseYet(stderr) {
  return /^release not found\s*$/i.test(String(stderr ?? '').trim());
}

export function liveDownload(stdout, assetName) {
  let j;
  try { j = JSON.parse(stdout); } catch { return null; }
  if (!j || typeof j.tagName !== 'string') return null;
  const asset = (Array.isArray(j.assets) ? j.assets : []).find((a) => a?.name === assetName);
  if (!asset) return { tag: j.tagName, size: 0, updatedAt: null, downloadCount: 0, missing: true };
  return { tag: j.tagName, ...asset, missing: false };
}
