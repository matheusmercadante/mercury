// THE ISLAND'S PAGE (w-2a3136a92a). One black shape hanging from the top of
// the window (main/notch-island.mjs), in one of three sizes the main process
// picks: shut, the mark on one side of the camera and the count on the other;
// peek, grown to show what just arrived; open, the list. The page draws it,
// moves it between sizes, and says how big each size is so the window can make
// room first. The words, the counting and the hiding are the corner tag's
// (shared/corner-tag.mjs).
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HIDE_CHOICES, cardLines, inPoints } from '../../../shared/corner-tag.mjs';
import { OPEN_WIDTH } from '../../../shared/notch-island.mjs';
import { NAME } from '../../../shared/product-name.mjs';
import { Lattice, Move, markMoves } from '../corner-tag/lattice';
import '../corner-tag/corner-tag.css';
import './notch-island.css';

type Ready = { id: string; title: string; says: string; since?: number; open?: string | null };
type Mode = 'shut' | 'peek' | 'open';
// bar: the height of the strip it fills; notch: the camera's width, 0 on a
// screen without one.
type State = { ready: Ready[]; before?: number; working: number; now: number; mode: Mode; peek?: Ready | null; bar: number; notch: number };
type Sizes = { width: number; shut: number; peek: number; open: number };

type Bridge = {
  onState: (fn: (s: State) => void) => () => void;
  zoom?: () => number;
  ready: () => Promise<unknown>;
  size: (s: Sizes) => Promise<unknown>;
  hover: (inside: boolean) => Promise<unknown>;
  clickable: (on: boolean) => Promise<unknown>;
  go: (id: string | null) => Promise<unknown>;
  dismiss: (id: string) => Promise<unknown>;
  hide: (choice: string) => Promise<unknown>;
  shut: () => Promise<unknown>;
  settings: () => Promise<unknown>;
  menu: () => Promise<unknown>;
};

const bridge = (window as unknown as { notchIsland?: Bridge }).notchIsland ?? null;
const params = new URLSearchParams(location.search);
const RANK: Record<Mode, number> = { shut: 0, peek: 1, open: 2 };
// Room past the shape for its spring to overshoot into; it is clear, so a
// click there goes through.
const SLACK = 14;

// For pictures: ?demo=shut|peek|open, &notch=<width> (0 for a screen without
// one), &bar=<height>, &n=<how many>, &page=light|dark for what is behind it.
function demoState(): State | null {
  const demo = params.get('demo');
  if (!demo) return null;
  const now = Date.now();
  const n = Number(params.get('n') ?? 3);
  const titles = ['Notification tray to dynamic island', 'Login redirect', 'Onboarding emails', 'Pricing page', 'Release notes'];
  const ready = Array.from({ length: n }, (_, i) => ({
    id: `demo-${i}`, title: titles[i % titles.length], says: i === 1 ? 'needs a yes' : 'is ready for you', since: now - [0.2, 9, 25, 40, 70][i % 5] * 60_000,
  }));
  const mode = (['shut', 'peek', 'open'].includes(demo) ? demo : 'shut') as Mode;
  return {
    ready, before: Number(params.get('before') ?? 0), working: Number(params.get('working') ?? 4), now, mode,
    peek: mode === 'peek' ? ready[0] : null, bar: Number(params.get('bar') ?? 32), notch: Number(params.get('notch') ?? 185),
  };
}
const demo = demoState();

function useIslandState() {
  const [state, setState] = useState<State>(demo ?? { ready: [], working: 0, now: Date.now(), mode: 'shut', bar: 30, notch: 0 });
  useEffect(() => bridge?.onState((s) => setState(s)), []);
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

function Line({ item, onX }: { item: Ready & { waited: string }; onX?: () => void }) {
  return (
    <div className="ni-row">
      <button className="ni-line" onClick={() => bridge?.go(item.open === undefined ? item.id : item.open)}>
        <span className="ni-pip" />
        <span className="ni-name">{item.title}</span>
        <span className="ni-says">{item.says}</span>
        <span className="ni-when">{item.waited}</span>
      </button>
      {onX && (
        <button className="ni-x" aria-label={`Clear ${item.title} from the tray`} title="Clear from the tray" onClick={onX}>
          <svg viewBox="0 0 10 10" aria-hidden><path d="M2.6 2.6l4.8 4.8M7.4 2.6l-4.8 4.8" /></svg>
        </button>
      )}
    </div>
  );
}

function List({ state }: { state: State }) {
  const { lines, more } = cardLines(state.ready, state.now);
  return (
    <>
      <div className="ni-quiet ni-head">New since you left</div>
      {lines.map((l) => <Line key={l.id} item={l} onX={() => bridge?.dismiss(l.id)} />)}
      {more > 0 && <button className="ni-line ni-quiet" onClick={() => bridge?.go(null)}><span className="ni-pip-sp" />and {more} more</button>}
      {(state.before ?? 0) > 0 && <button className="ni-line ni-quiet" onClick={() => bridge?.go(null)}><span className="ni-pip-sp" />and {state.before} from before</button>}
      {state.working > 0 && (
        <button className="ni-line ni-quiet" onClick={() => bridge?.go(null)}>
          <span className="ni-pip-sp" />{state.working} others working
        </button>
      )}
      <div className="ni-foot">
        <span>Hide for</span>
        {HIDE_CHOICES.map((c: { key: string; label: string }) => (
          <button key={c.key} onClick={() => bridge?.hide(c.key)}>{c.label}</button>
        ))}
        <span className="ni-sep" />
        <button onClick={() => bridge?.settings()}>Turn off…</button>
      </div>
    </>
  );
}

function Island({ state }: { state: State }) {
  const bar = state.bar > 0 ? state.bar : 30;
  const notched = state.notch > 0;
  const ear = Math.round(bar * 1.3);
  const n = state.ready.length;
  const flatRef = useRef<HTMLDivElement>(null);
  const peekRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState({ flat: 0, peek: 0, open: 0 });
  const was = useRef<Mode>(state.mode);
  const growing = RANK[state.mode] >= RANK[was.current];
  useEffect(() => { was.current = state.mode; }, [state.mode]);

  useLayoutEffect(() => {
    const read = () => setMeasured({
      flat: flatRef.current?.getBoundingClientRect().width ?? 0,
      peek: peekRef.current?.getBoundingClientRect().height ?? 0,
      open: openRef.current?.getBoundingClientRect().height ?? 0,
    });
    read();
    const ro = new ResizeObserver(read);
    for (const r of [flatRef, peekRef, openRef]) if (r.current) ro.observe(r.current);
    return () => ro.disconnect();
  }, [notched]);

  // On a notch the camera sits between the two ears; elsewhere the words
  // take its place.
  const shutWidth = notched ? state.notch + 2 * ear : Math.ceil(measured.flat);
  const openWidth = Math.max(OPEN_WIDTH, shutWidth);
  const heights = { shut: bar, peek: Math.ceil(bar + measured.peek), open: Math.ceil(bar + measured.open) };
  const widths = { shut: shutWidth, peek: openWidth, open: openWidth };
  const shoulder = Math.round(bar * 0.25);

  useEffect(() => {
    if (!bridge || !measured.peek || !measured.open || !shutWidth) return;
    const z = bridge.zoom?.() ?? 1;
    const pt = (v: number) => inPoints({ width: v, height: 0 }, z).width;
    bridge.size({
      width: pt(openWidth + 2 * shoulder + 2 * SLACK),
      shut: pt(heights.shut), peek: pt(heights.peek + SLACK), open: pt(heights.open + SLACK),
    });
  }, [openWidth, shoulder, heights.shut, heights.peek, heights.open, shutWidth]);

  const mode = state.mode;
  const peekItem = cardLines([state.peek ?? state.ready[0]].filter(Boolean) as Ready[], state.now, 1).lines[0] ?? null;
  const style = {
    width: `${widths[mode]}px`, height: `${heights[mode]}px`,
    '--ni-bar': `${bar}px`, '--ni-ear': `${ear}px`, '--ni-notch': `${state.notch}px`, '--ni-sh': `${shoulder}px`,
    '--ni-r': `${mode === 'shut' ? Math.round(bar * 0.4) : 22}px`, '--ni-open-w': `${openWidth}px`,
    '--ni-type': `${Math.round(bar * 0.42)}px`,
  } as React.CSSProperties;
  const mark = <Mark count={n} box={Math.round(bar * 0.36)} />;

  return (
    <div
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
            <span className="ni-ear ni-count">{n}</span>
          </>
        ) : (
          <div ref={flatRef} className="ni-flat">
            {mark}
            <span className="ni-count">{n} waiting</span>
          </div>
        )}
      </div>
      <div ref={peekRef} className={`ni-body ni-peek${mode === 'peek' ? ' is-on' : ''}`}>
        {peekItem ? <Line item={peekItem} /> : <div className="ni-line">&nbsp;</div>}
      </div>
      <div ref={openRef} className={`ni-body${mode === 'open' ? ' is-on' : ''}`}>
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
  const bar = Number(params.get('bar') ?? 32);
  const notch = Number(params.get('notch') ?? 185);
  const light = params.get('page') !== 'dark';
  return (
    <div className={`ni-demo${light ? ' is-light' : ''}`} style={{ '--ni-demo-bar': `${bar}px` } as React.CSSProperties}>
      <div className="ni-demo-menu">
        <span className="ni-demo-left"><b>Safari</b><span>File</span><span>Edit</span><span>View</span><span>History</span><span>Window</span></span>
        <span className="ni-demo-right"><span>Sun 1 Nov</span><span>22:41</span></span>
      </div>
      {notch > 0 && <div className="ni-demo-notch" style={{ width: `${notch}px`, height: `${bar}px` }} />}
      <div className="ni-demo-page"><div /><div /><div /><div /></div>
      <div className="ni-stage">{children}</div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Page />);
