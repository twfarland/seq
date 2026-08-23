import type { Clip, Lane, Pattern, Step } from "./pattern";

/** GM percussion note numbers used by the starter pattern. */
const GM = {
  kick: 36,
  snare: 38,
  closedHat: 42,
} as const;

/** GM reserves channel 10 for percussion. */
const DRUM_CHANNEL = 10;

export const DEFAULT_VELOCITY = 100;

export const makeStep = (
  velocity = DEFAULT_VELOCITY,
  lengthInSteps = 1
): Step => ({ velocity, lengthInSteps });

/** Build a lane whose steps fire on exactly the given indices. */
function laneOn(instrument: string, midiNote: number, on: number[]): Lane {
  return {
    instrument,
    midiNote,
    steps: Object.fromEntries(on.map((index) => [index, makeStep()])),
  };
}

const range = (length: number) => Array.from({ length }, (_, i) => i);

/** A 4/4 bar of sixteenths - the pattern the app opens with. */
export function fourOnTheFloor(): Pattern {
  const clip: Clip = {
    name: "Drums",
    channel: DRUM_CHANNEL,
    beatsPerMeasure: 4,
    subdivisionPerBeat: 4,
    lanes: [
      laneOn("kick", GM.kick, [0, 4, 8, 12]),
      laneOn("snare", GM.snare, [4, 12]),
      laneOn("closed hihat", GM.closedHat, range(16)),
    ],
  };

  return { name: "Four on the Floor", clips: [clip] };
}

export function emptyClip(name: string, channel: number): Clip {
  return {
    name,
    channel,
    beatsPerMeasure: 4,
    subdivisionPerBeat: 4,
    lanes: [emptyLane()],
  };
}

export function emptyLane(): Lane {
  return { instrument: "note", midiNote: 60, steps: {} };
}
