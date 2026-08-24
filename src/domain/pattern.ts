/**
 * The musical data model. Everything here is plain, structured-cloneable data
 * so a `Pattern` can cross the worker boundary via `postMessage` unchanged.
 */

/** Standard MIDI clock rate: 24 pulses per quarter note. Fixed by the spec. */
export const MIDI_CLOCK_PPQ = 24;

export const BPM_RANGE = { min: 20, max: 400 } as const;
export const PPQ_RANGE = { min: 1, max: 960 } as const;
export const VELOCITY_RANGE = { min: 1, max: 127 } as const;

/** A note event placed on a lane. Absence of a `Step` means "rest". */
export interface Step {
  /** MIDI velocity, 1..127. */
  velocity: number;
  /** Gate length measured in steps of the owning clip. */
  lengthInSteps: number;
}

/** One monophonic row of a clip — a single MIDI note played over time. */
export interface Lane {
  /** Human label only; has no effect on playback. e.g. "kick", "C4". */
  instrument: string;
  /** e.g. 36 for a GM kick, 60 for middle C. */
  midiNote: number;
  /**
   * Sparse map of step index -> step. Sparse (rather than a fixed-length
   * array) so changing a clip's time signature never destroys note data that
   * falls outside the new bar length — it just stops sounding.
   */
  steps: Record<number, Step>;
}

/**
 * A looping bar of lanes on one MIDI channel. Clips loop independently: a clip
 * with a different bar length simply wraps at its own boundary, which is what
 * makes polymetric patterns possible.
 */
export interface Clip {
  name: string;
  /** 1-based MIDI channel, 1..16 (10 is the GM drum channel). */
  channel: number;
  lanes: Lane[];
  beatsPerMeasure: number;
  subdivisionPerBeat: number;
}

export interface Pattern {
  name: string;
  clips: Clip[];
}

/** Number of steps in one loop of `clip`. */
export function stepsPerLoop(clip: Clip): number {
  return Math.max(1, clip.beatsPerMeasure * clip.subdivisionPerBeat);
}

/**
 * How many clock pulses elapse between two steps of `clip`.
 *
 * Returns `null` when the clip's subdivision does not divide evenly into the
 * clock resolution (e.g. quintuplets at 24 PPQ). Rounding instead would smear
 * the grid, so such clips are reported as unplayable and skipped — see
 * {@link clipTimingError}.
 */
export function pulsesPerStep(clip: Clip, ppq: number): number | null {
  const subdivision = clip.subdivisionPerBeat;
  if (!Number.isInteger(subdivision) || subdivision < 1) return null;
  if (ppq % subdivision !== 0) return null;
  return ppq / subdivision;
}

/** Human-readable reason a clip cannot be played at `ppq`, or `null` if it can. */
export function clipTimingError(clip: Clip, ppq: number): string | null {
  if (!Number.isInteger(clip.beatsPerMeasure) || clip.beatsPerMeasure < 1) {
    return "Beats per measure must be a whole number of at least 1.";
  }
  if (pulsesPerStep(clip, ppq) === null) {
    return `PPQ ${ppq} is not divisible by ${clip.subdivisionPerBeat} — raise PPQ to a multiple (e.g. ${lowestCompatiblePpq(clip)}).`;
  }
  return null;
}

/** Smallest PPQ >= the MIDI default that can represent `clip`'s grid. */
export function lowestCompatiblePpq(clip: Clip): number {
  const subdivision = Math.max(1, Math.floor(clip.subdivisionPerBeat) || 1);
  return Math.ceil(MIDI_CLOCK_PPQ / subdivision) * subdivision;
}

export function clamp(value: number, min: number, max: number): number {
  // NaN survives both Math.min and Math.max, so reject it up front. This is the
  // difference between an empty <input type="number"> and a frozen tab.
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Milliseconds between clock pulses. */
export function pulseIntervalMs(bpm: number, ppq: number): number {
  return 60_000 / (bpm * ppq);
}
