// A RECORDING, SHOWN WHERE A NEW VERSION IS: the same card above the foot, and
// with the sidebar narrow the same row that widens into it (SidebarUpdate.tsx).
// Its dot is the voice note's, because it means the same thing.

import { useEffect, useState } from 'react';
import { clock, type MeetingCard, type MeetingPress } from '../meeting-card';
import { CloseIcon, RailCard, SIDE_SAY } from './SidebarUpdate';

export function RecordIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><g transform="translate(12 12) scale(.8) translate(-12 -12)" strokeWidth="1.5625"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></g></svg>;
}

function LiveDot() {
  return <svg className="sb-meeting-dot" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/></svg>;
}

export function SidebarMeeting({ card, collapsed, rail = false, onPress, onClose }: {
  card: MeetingCard;
  collapsed: boolean;
  /** The sidebar widens under the pointer: the card rises out of the row (`RailCard`). */
  rail?: boolean;
  onPress: (action: MeetingPress) => void;
  onClose: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (card.clockFrom == null) return undefined;
    const every = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(every);
  }, [card.clockFrom]);

  const time = card.clockFrom == null ? null : clock(now - card.clockFrom);
  const icon = card.live ? <LiveDot /> : <RecordIcon />;
  const heading = time ? `${card.title} · ${time}` : card.title;
  const { press } = card;
  const row = <button type="button" className="sb-update-row" title={card.text ? `${heading}. ${card.text}` : heading} aria-label={press?.label ?? heading} disabled={!press} onClick={press ? () => onPress(press.action) : undefined}>
    {icon}<span>{press?.label ?? heading}</span>
  </button>;

  if (rail) return <RailCard icon={icon} title={heading} text={card.text ?? ''} closeTip={SIDE_SAY.close} closable={card.closable} quiet={!press} onClose={onClose} row={row} />;
  if (collapsed) return row;

  return <div className="sb-update-card">
    <div className="sb-update-card-title">{icon}<span>{heading}</span></div>
    {card.closable && <button type="button" className="sb-update-close" aria-label={SIDE_SAY.close} title={SIDE_SAY.close} onClick={onClose}><CloseIcon /></button>}
    {card.text && <p>{card.text}</p>}
    {press && <button type="button" className="sb-update-go" onClick={() => onPress(press.action)}>{press.label}</button>}
  </div>;
}
