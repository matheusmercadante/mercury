// THE ISLAND'S PAGE (w-2a3136a92a). One island hanging from the top of the
// window (main/notch-island.mjs), in one of two sizes the main process picks:
// shut, the tray's mark on one side of the camera and its count on the other,
// and open, the tray's list. It is drawn in the tray's own glass and words
// (renderer/src/corner-tag), so the only new thing about it is where it is and
// that it grows out of the notch rather than opening a second window.
//
// The page moves the island between its sizes, says how big each size is so
// the window can make room first, and says where the island is on every frame
// it moves, so the Mac's glass can follow it.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HIDE_CHOICES, cardLines, cardScale, inPoints } from '../../../shared/corner-tag.mts';
import { NAME } from '../../../shared/product-name.mjs';
import { Lattice, Move, markMoves } from '../corner-tag/lattice';
import '../corner-tag/corner-tag.css';
import './notch-island.css';

type Ready = { id: string; title: string; says: string; since?: number; open?: string | null };
type Mode = 'shut' | 'open';
// bar: the height of the strip it fills; notch: the camera's width, 0 on a
// screen without one; scale: the tray's size for this screen; glass: the Mac
// draws the glass, so this page draws none.
type State = { ready: Ready[]; before?: number; working: number; now: number; mode: Mode; bar: number; notch: number; scale?: number; glass?: boolean };
type Tone = 'light' | 'dark';
type Rect = { x: number; y: number; width: number; height: number };

type Bridge = {
  onState: (fn: (s: State) => void) => () => void;
  onTone?: (fn: (tone: Tone) => void) => () => void;
  zoom?: () => number;
  ready: () => Promise<unknown>;
  size: (s: { width: number; shut: number; open: number }) => Promise<unknown>;
  shape: (s: Rect & { radius: number }) => Promise<unknown>;
  hover: (inside: boolean) => Promise<unknown>;
  clickable: (on: boolean) => Promise<unknown>;
  go: (id: string | null) => Promise<unknown>;
  dismiss: (id: string) => Promise<unknown>;
  hide: (choice: string) => Promise<unknown>;
  resize: (by: number) => Promise<unknown>;
  shut: () => Promise<unknown>;
  settings: () => Promise<unknown>;
  menu: () => Promise<unknown>;
};

const bridge = (window as unknown as { notchIsland?: Bridge }).notchIsland ?? null;
const params = new URLSearchParams(location.search);
// Room past the island for its spring to overshoot into; it is clear, so a
// click there goes through.
const SLACK = 14;
// How long the island takes to move (notch-island.css), and a little more:
// the glass is told where it is on every frame of that.
const MOVE_MS = 520;

// For pictures: ?demo=shut|open, &notch=<width> (0 for a screen without one),
// &bar=<height>, &s=<the tray's scale>, &n=<how many>, &page=dark behind it.
function demoState(): State | null {
  const demo = params.get('demo');
  if (!demo) return null;
  const now = Date.now();
  const n = Number(params.get('n') ?? 3);
  const titles = ['Pricing page', 'Login redirect', 'Onboarding emails', 'Settings page', 'Release notes'];
  const ready = Array.from({ length: n }, (_, i) => ({
    id: `demo-${i}`, title: titles[i % titles.length], says: i === 1 ? 'needs a yes' : 'is ready for you', since: now - [2, 9, 25, 40, 70][i % 5] * 60_000,
  }));
  return {
    ready, before: Number(params.get('before') ?? 0), working: Number(params.get('working') ?? 17), now,
    mode: demo === 'open' ? 'open' : 'shut', bar: Number(params.get('bar') ?? 37), notch: Number(params.get('notch') ?? 186),
    scale: Number(params.get('s') ?? 1.1),
  };
}
const demo = demoState();

function useIslandState() {
  const [state, setState] = useState<State>(demo ?? { ready: [], working: 0, now: Date.now(), mode: 'shut', bar: 30, notch: 0 });
  useEffect(() => bridge?.onState((s) => setState(s)), []);
  // The tray's one number for its size, and the list's share of it
  // (shared/corner-tag.mts, tagScale and cardScale).
  useEffect(() => {
    if (!state.scale) return;
    const root = document.documentElement;
    root.style.setProperty('--ct-s', String(state.scale));
    root.style.setProperty('--ct-cs', String(cardScale(state.scale)));
  }, [state.scale]);
  // Where the Mac draws the glass the page draws none, and the ink follows the
  // glass, exactly as on the corner tag.
  useEffect(() => { document.documentElement.classList.toggle('ct-native', !!state.glass); }, [state.glass]);
  useEffect(() => bridge?.onTone?.((tone) => {
    const root = document.documentElement;
    root.classList.toggle('ct-tone-dark', tone === 'dark');
    root.classList.toggle('ct-tone-light', tone === 'light');
  }), []);
  return state;
}

// The mark pops when the count goes up and does nothing when it goes down
// (renderer/src/corner-tag/lattice.tsx, markMoves).
function Mark({ count, box }: { count: number; box: number }) {
  const before = useRef<{ kind: string; count: number } | null>(null);
  const [beat, setBeat] = useState<{ move: Move; n: number }>({ move: 'none', n: 0 });
  useEffect(() => {
    const says = { kind: 'ready', count };
    const move = markMoves(before.current, says);
    before.current = says;
    if (move !== 'none') setBeat((b) => ({ move, n: b.n + 1 }));
  }, [count]);
  return <Lattice box={box} lit move={beat.move} beat={beat.n} />;
}

// The corner tag's list (renderer/src/corner-tag/main.tsx, CardBody), line for
// line, without Move to: the island has nowhere else to go.
function List({ state }: { state: State }) {
  const { lines, more } = cardLines(state.ready, state.now);
  const cs = cardScale(state.scale ?? 1);
  return (
    <>
      {lines.length > 0 && <div className="ct-quiet ct-static ct-head">New since you left</div>}
      {lines.map((l) => (
        <div key={l.id} className="ct-row">
          <button className="ct-line" onClick={() => bridge?.go(l.open === undefined ? l.id : l.open)}>
            <span className="ct-pip" />
            <span className="ct-name">{l.title}</span>
            <span className="ct-says">{l.says}</span>
            <span className="ct-when">{l.waited}</span>
          </button>
          <button className="ct-x" aria-label={`Clear ${l.title} from the tray`} title="Clear from the tray" onClick={() => bridge?.dismiss(l.id)}>
            <svg viewBox="0 0 10 10" aria-hidden><path d="M2.6 2.6l4.8 4.8M7.4 2.6l-4.8 4.8" /></svg>
          </button>
        </div>
      ))}
      {more > 0 && <button className="ct-line ct-quiet" onClick={() => bridge?.go(null)}><span className="ct-mark-sp" />and {more} more</button>}
      {(state.before ?? 0) > 0 && <button className="ct-line ct-quiet" onClick={() => bridge?.go(null)}><span className="ct-mark-sp" />and {state.before} from before</button>}
      {!lines.length && <div className="ct-quiet ct-static">Nothing is ready for you yet</div>}
      {state.working > 0 && (
        <button className="ct-line ct-quiet" onClick={() => bridge?.go(null)}>
          <Lattice box={10 * cs} lit={false} move="none" beat={0} />
          {lines.length ? `${state.working} others working` : `${state.working} working`}
        </button>
      )}
      <div className="ct-foot">
        <span>Hide for</span>
        {HIDE_CHOICES.map((c: { key: string; label: string }) => (
          <button key={c.key} onClick={() => bridge?.hide(c.key)}>{c.label}</button>
        ))}
        <span className="ct-size">
          <span className="ct-size-name">Size</span>
          <span className="ct-steps">
            <button aria-label="Smaller" title="Smaller" onClick={() => bridge?.resize(-1)}>
              <svg viewBox="0 0 10 10" aria-hidden><path d="M2.4 5h5.2" /></svg>
            </button>
            <button aria-label="Bigger" title="Bigger" onClick={() => bridge?.resize(1)}>
              <svg viewBox="0 0 10 10" aria-hidden><path d="M2.4 5h5.2M5 2.4v5.2" /></svg>
            </button>
          </span>
        </span>
        <span className="ct-sep" />
        <button className="ct-off" onClick={() => bridge?.settings()}>Turn off…</button>
      </div>
    </>
  );
}

function Island({ state }: { state: State }) {
  const bar = state.bar > 0 ? state.bar : 30;
  const s = state.scale ?? 1;
  const notched = state.notch > 0;
  const n = state.ready.length;
  // The tag's mark and count, at the tag's size for this screen, as long as
  // they fit the strip they sit in.
  const box = Math.min(10 * s, bar * 0.44);
  const type = Math.min(13 * s, bar * 0.56);
  const ear = Math.round(bar * 1.3);
  const islandRef = useRef<HTMLDivElement>(null);
  const flatRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState({ flat: 0, listW: 0, listH: 0 });
  const was = useRef<Mode>(state.mode);
  const growing = state.mode === 'open' || was.current === 'shut';
  useEffect(() => { was.current = state.mode; }, [state.mode]);

  useLayoutEffect(() => {
    const read = () => {
      const list = listRef.current?.getBoundingClientRect();
      setMeasured({ flat: flatRef.current?.getBoundingClientRect().width ?? 0, listW: list?.width ?? 0, listH: list?.height ?? 0 });
    };
    read();
    const ro = new ResizeObserver(read);
    for (const r of [flatRef, listRef]) if (r.current) ro.observe(r.current);
    return () => ro.disconnect();
  }, [notched]);

  // On a notch the camera sits between the two ears; elsewhere the mark and
  // the count sit side by side, as on the tag.
  const shutWidth = notched ? state.notch + 2 * ear : Math.ceil(measured.flat);
  const openWidth = Math.max(shutWidth, Math.ceil(measured.listW));
  const heights = { shut: bar, open: Math.ceil(bar + measured.listH) };
  const widths = { shut: shutWidth, open: openWidth };
  const radius = state.mode === 'shut' ? Math.round(6 * s) : Math.round(8 * cardScale(s));

  // How big each size is, so the window makes room before the island moves.
  useEffect(() => {
    if (!bridge || !measured.listH || !shutWidth) return;
    const z = bridge.zoom?.() ?? 1;
    const pt = (v: number) => inPoints({ width: v, height: 0 }, z).width;
    bridge.size({ width: pt(openWidth + 2 * SLACK), shut: pt(heights.shut), open: pt(heights.open + SLACK) });
  }, [openWidth, heights.shut, heights.open, shutWidth]);

  // Where it is, on every frame it moves, so the Mac's glass is laid exactly
  // under it. Only where the Mac draws the glass.
  useEffect(() => {
    if (!bridge || !state.glass) return;
    let frame = 0;
    let last = '';
    const until = performance.now() + MOVE_MS;
    const tell = () => {
      const el = islandRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const round = parseFloat(getComputedStyle(el).borderBottomLeftRadius) || 0;
        const m = inPoints({ width: r.width, height: r.height, glass: { x: r.x, y: r.y, width: r.width, height: r.height }, radius: round }, bridge.zoom?.());
        const g = m.glass!;
        const key = `${g.x}|${g.y}|${g.width}|${g.height}|${m.radius}`;
        if (key !== last && g.width > 0 && g.height > 0) {
          last = key;
          bridge.shape({ ...g, radius: m.radius ?? 0 });
        }
      }
      if (performance.now() < until) frame = requestAnimationFrame(tell);
    };
    tell();
    return () => cancelAnimationFrame(frame);
  }, [state.mode, state.glass, widths.shut, widths.open, heights.shut, heights.open]);

  const mode = state.mode;
  const style = {
    width: `${widths[mode]}px`, height: `${heights[mode]}px`,
    '--ni-bar': `${bar}px`, '--ni-ear': `${ear}px`, '--ni-notch': `${state.notch}px`,
    '--ni-r': `${radius}px`, '--ni-type': `${type}px`,
  } as React.CSSProperties;
  const mark = <Mark count={n} box={box} />;

  return (
    <div
      ref={islandRef}
      className={`ni-island is-${mode}${growing ? ' is-growing' : ''}`}
      style={style}
      onPointerEnter={() => bridge?.hover(true)}
      onPointerLeave={() => bridge?.hover(false)}
      onContextMenu={(e) => { e.preventDefault(); bridge?.menu(); }}
    >
      <div
        role="button"
        aria-label={`${n} waiting. Click to open ${NAME}.`}
        aria-expanded={mode === 'open'}
        className="ni-bar"
        onClick={() => bridge?.go(null)}
      >
        {notched ? (
          <>
            <span className="ni-ear">{mark}</span>
            <span className="ni-cam" />
            <span className="ni-ear"><span className="ct-count">{n}</span></span>
          </>
        ) : (
          <div ref={flatRef} className="ni-flat">
            {mark}
            <span className="ct-count">{n}</span>
          </div>
        )}
      </div>
      <div ref={listRef} className={`ni-list${mode === 'open' ? ' is-on' : ''}`}>
        <List state={state} />
      </div>
    </div>
  );
}

function Page() {
  const state = useIslandState();
  const over = useRef<boolean | null>(null);
  useEffect(() => { bridge?.ready(); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') bridge?.shut(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  // What is under the pointer: the island takes the click, anything else in
  // the window lets it through. Moves arrive either way, because the window
  // forwards them.
  const say = (on: boolean) => {
    if (over.current === on) return;
    over.current = on;
    bridge?.clickable(on);
  };
  const island = <Island state={state} />;
  if (demo) return <DemoScreen>{island}</DemoScreen>;
  return (
    <div
      className="ni-stage"
      onPointerMove={(e) => say(!!document.elementFromPoint(e.clientX, e.clientY)?.closest('.ni-island'))}
      onPointerLeave={() => say(false)}
    >
      {island}
    </div>
  );
}

// The top of a screen for the pictures: a page, its menu bar, and the notch
// itself in black where there is one, so the island is seen against it.
function DemoScreen({ children }: { children: React.ReactNode }) {
  const bar = Number(params.get('bar') ?? 37);
  const notch = Number(params.get('notch') ?? 186);
  const light = params.get('page') !== 'dark';
  return (
    <div className={`ni-demo${light ? ' is-light' : ''}`} style={{ '--ni-demo-bar': `${bar}px` } as React.CSSProperties}>
      <div className="ni-demo-menu">
        <span className="ni-demo-left"><b>Safari</b><span>File</span><span>Edit</span><span>View</span><span>History</span><span>Window</span></span>
        <span className="ni-demo-right"><span>Sun 1 Nov</span><span>22:41</span></span>
      </div>
      <div className="ni-demo-page"><div /><div /><div /><div /></div>
      <div className="ni-stage">{children}</div>
      {notch > 0 && <div className="ni-demo-notch" style={{ width: `${notch}px`, height: `${bar}px` }} />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Page />);
