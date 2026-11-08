// THE MICROPHONE ON THIS PHONE, for the row on the web app's Account page
// (./components/WebMicrophone.tsx), and what a phone says when it will not open.
//
// A phone's browser asks for itself when the page opens the microphone, and that
// answer is the only true one. Safari has been reported to go on saying "prompt"
// after a yes (WebKit 257710, read 2026-11-08), so what the browser reports is a
// hint and the press is the test. A home-screen app has been reported to be
// asked again when it is reopened (WebKit 215884), so a yes is said as for now.

export type MicState = 'on' | 'off' | 'blocked' | 'unsupported';

type Stream = { getTracks: () => { stop: () => void }[] };
export type MicWorld = {
  open?: (constraints: { audio: true }) => Promise<Stream>;
  read?: () => Promise<string | null | undefined>;
};

function browserMic(): MicWorld {
  const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  return {
    open: media?.getUserMedia ? (constraints) => media.getUserMedia(constraints) : undefined,
    read: async () => (await navigator.permissions?.query({ name: 'microphone' as PermissionName }))?.state,
  };
}

const refusedByThePhone = (err: unknown) => /^(NotAllowedError|SecurityError)$/.test((err as { name?: string })?.name ?? '');

/** What a microphone that will not open says on a phone, where there is no System Settings to send anyone to. */
export function phoneMicRefusal(err: unknown): string {
  const name = (err as { name?: string })?.name ?? '';
  if (refusedByThePhone(err)) return 'The microphone is not allowed yet. Allow it in Settings, under Account, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'This phone did not offer a microphone. Try again in a moment.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'Something else on this phone is using the microphone, like a call. End it and try again.';
  return 'The microphone could not be opened. Try again.';
}

// A yes given on this visit, however stale the browser's own report.
let allowedHere = false;

export async function micState(world: MicWorld = browserMic()): Promise<MicState> {
  if (!world.open) return 'unsupported';
  if (allowedHere) return 'on';
  const said = await world.read?.().catch(() => null);
  if (said === 'granted') return 'on';
  return said === 'denied' ? 'blocked' : 'off';
}

/** Must run inside a press. This only asks: the microphone is let go at once. */
export async function allowMic(world: MicWorld = browserMic()): Promise<MicState> {
  if (!world.open) return 'unsupported';
  let stream: Stream;
  try {
    stream = await world.open({ audio: true });
  } catch (err) {
    if (refusedByThePhone(err)) return 'blocked';
    throw new Error(phoneMicRefusal(err));
  }
  stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
  allowedHere = true;
  return 'on';
}
