export interface Step {
  velocity: number;
  lengthInSteps: number;
}

export interface Lane {
  instrument: string; // e.g. "kick", "C4"
  midiNote: number; // e.g. 36 for kick, 60 for C4
  steps: Map<number, Step>; // step index -> velocity, length
}

export interface Clip {
  name: string; // e.g. "Drums"
  channel: number;
  lanes: Lane[];
  beatsPerMeasure: number;
  subdivisionPerBeat: number;
}

export interface Pattern {
  name: string;
  clips: Clip[];
}

export function calculateLengthInSteps(
  beats: number,
  stepsPerBeat: number
): number {
  return beats * stepsPerBeat;
}
