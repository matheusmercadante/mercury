// THE MICROPHONE ON THIS PHONE, on the web app's Account page, under alerts and
// drawn the same way (./WebAlerts.tsx). A place to allow it ahead of a meeting,
// and to find out why it will not open (../phone-mic.ts).
import { useEffect, useState } from 'react';
import { Name } from '../../../shared/product-name.mjs';
import { allowMic, micState, type MicState } from '../phone-mic';

const LABEL: Record<MicState, string> = { off: 'Microphone', on: 'Microphone is allowed', blocked: 'Microphone is blocked', unsupported: 'Microphone' };
const SAY: Record<MicState, string> = {
  off: 'Allow it here, so Record meeting can hear the room.',
  on: 'Record meeting can hear the room. The phone may ask once more when you reopen the app.',
  blocked: `Close ${Name} and open it again, then press Ask again. If the phone does not ask, set Microphone to Ask in the phone's Settings, under Safari.`,
  unsupported: 'This browser cannot use the microphone.',
};

export function WebMicGroup() {
  const [state, setState] = useState<MicState | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void micState().then(setState); }, []);
  if (!state) return null;
  const ask = async () => {
    setBusy(true); setSaid(null);
    try { setState(await allowMic()); } catch (err) { setSaid(String((err as Error)?.message ?? err)); }
    setBusy(false);
  };
  return (
    <div className="set-group" data-find="microphone">
      <div className="set-group-label"><span>Microphone on this phone</span></div>
      <div className="set-plate">
        <div className="set-row">
          <div className="set-row-text">
            <div className="set-row-label">{LABEL[state]}</div>
            <div className="set-row-desc">{said ?? SAY[state]}</div>
          </div>
          {(state === 'off' || state === 'blocked') && (
            <div className="set-row-ctl"><button type="button" className="set-ghost" disabled={busy} onClick={() => void ask()}>{state === 'off' ? 'Allow' : 'Ask again'}</button></div>
          )}
        </div>
      </div>
    </div>
  );
}
