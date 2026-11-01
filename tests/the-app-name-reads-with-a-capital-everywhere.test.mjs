// THE APP'S NAME READS WITH A CAPITAL, EVERYWHERE (w-23fa810982, 2026-10-02).
//
// The name was kept lowercase on purpose mid-sentence, so pressing Restart to
// update read "Updating. agentbox restarts by itself in about a minute." and
// the window title, the Dock and every "quit and reopen agentbox" said the same.
// The ask: capitalise it, there and everywhere else in the app. Measured
// before this change: NAME was 'agentbox', and it fed 70 sentences. The rule
// outlived that name, so this checks it for whatever NAME is now.
//
// The capital has one cost to watch: lines the app wrote to disk in another
// letter case. A relayed message starts "Relayed from <name>," in transcripts
// that already exist, and must still be recognised as the app talking, never
// quoted back as something the person typed.

import { describe, expect, it } from 'vitest';
import { NAME, Name, nameSlug, ENV_PREFIX, possessive } from '../shared/product-name.mjs';
import { SAY } from '../renderer/src/update-row.ts';
import { __wasRelayed, fromTheApp } from '../main/agents.mjs';

describe('the name', () => {
  it(`is ${Name} mid-sentence as well as at the start of one`, () => {
    expect(NAME.charAt(0)).toMatch(/[A-Z]/);
    expect(NAME).toBe(Name);
    expect(possessive).toBe(`${Name}'s`);
  });

  it('reads with a capital in the restart line', () => {
    expect(SAY.installing).toBe(`Updating. ${Name} restarts by itself in about a minute.`);
    expect(SAY.installing).not.toMatch(new RegExp(`\\b${nameSlug}\\b`));
  });

  // The slug names folders and the store's MCP server, and the prefix names
  // env vars. Neither is something you read, and the capital must not reach them.
  it('keeps the slug lowercase and the env prefix uppercase', () => {
    expect(nameSlug).toBe(NAME.toLowerCase());
    expect(ENV_PREFIX).toBe(NAME.toUpperCase());
  });
});

describe('what the app wrote, in any letter case', () => {
  it('still recognises a relayed line written lowercase', () => {
    expect(__wasRelayed(`Relayed from ${nameSlug}, the inbox your user reads.`)).toBe(true);
  });

  it('recognises the line it writes now', () => {
    expect(fromTheApp('hi').startsWith(`Relayed from ${Name},`)).toBe(true);
    expect(__wasRelayed(fromTheApp('hi').replace(/\s+/g, ' '))).toBe(true);
  });

  it('does not take a person saying the name for the app talking', () => {
    expect(__wasRelayed(`${nameSlug}, relayed from somewhere`)).toBe(false);
    expect(__wasRelayed(`I relayed from ${nameSlug} yesterday`)).toBe(false);
  });
});
