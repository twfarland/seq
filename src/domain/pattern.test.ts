import { describe, expect, it } from "vitest";
import {
  MIDI_CLOCK_PPQ,
  clamp,
  clipTimingError,
  lowestCompatiblePpq,
  pulseIntervalMs,
  pulsesPerStep,
  stepsPerLoop,
  type Clip,
} from "./pattern";
import { emptyClip, emptyLane, fourOnTheFloor } from "./presets";

const clip = (overrides: Partial<Clip> = {}): Clip => ({
  ...emptyClip("Test", 1),
  ...overrides,
});

describe("clamp", () => {
  it("bounds values", () => {
    expect(clamp(5, 1, 10)).toBe(5);
    expect(clamp(-5, 1, 10)).toBe(1);
    expect(clamp(50, 1, 10)).toBe(10);
  });

  it("maps NaN to the minimum rather than letting it through", () => {
    // Math.min/Math.max both propagate NaN, which is how an empty number input
    // used to reach the clock and produce an infinite interval.
    expect(clamp(Number.NaN, 20, 400)).toBe(20);
  });
});

describe("pulseIntervalMs", () => {
  it("matches the MIDI clock rate at 120bpm", () => {
    expect(pulseIntervalMs(120, MIDI_CLOCK_PPQ)).toBeCloseTo(20.8333, 4);
  });

  it("is inversely proportional to tempo", () => {
    expect(pulseIntervalMs(60, 24)).toBeCloseTo(pulseIntervalMs(120, 24) * 2, 9);
  });
});

describe("stepsPerLoop", () => {
  it("multiplies beats by subdivision", () => {
    expect(stepsPerLoop(clip({ beatsPerMeasure: 4, subdivisionPerBeat: 4 }))).toBe(16);
    expect(stepsPerLoop(clip({ beatsPerMeasure: 3, subdivisionPerBeat: 2 }))).toBe(6);
  });

  it("never returns zero, so a degenerate clip cannot divide by zero", () => {
    expect(stepsPerLoop(clip({ beatsPerMeasure: 0 }))).toBe(1);
  });
});

describe("pulsesPerStep", () => {
  it("divides the clock resolution by the subdivision", () => {
    expect(pulsesPerStep(clip({ subdivisionPerBeat: 4 }), 24)).toBe(6);
    expect(pulsesPerStep(clip({ subdivisionPerBeat: 1 }), 24)).toBe(24);
  });

  it("rejects subdivisions that do not divide the clock evenly", () => {
    expect(pulsesPerStep(clip({ subdivisionPerBeat: 5 }), 24)).toBeNull();
    expect(pulsesPerStep(clip({ subdivisionPerBeat: 7 }), 24)).toBeNull();
  });

  it("rejects zero and fractional subdivisions", () => {
    expect(pulsesPerStep(clip({ subdivisionPerBeat: 0 }), 24)).toBeNull();
    expect(pulsesPerStep(clip({ subdivisionPerBeat: 1.5 }), 24)).toBeNull();
    expect(pulsesPerStep(clip({ subdivisionPerBeat: -4 }), 24)).toBeNull();
  });
});

describe("clipTimingError", () => {
  it("passes a well-formed clip", () => {
    expect(clipTimingError(clip(), MIDI_CLOCK_PPQ)).toBeNull();
  });

  it("explains an indivisible subdivision and suggests a PPQ", () => {
    const message = clipTimingError(clip({ subdivisionPerBeat: 5 }), 24);
    expect(message).toContain("25");
  });

  it("rejects a bar shorter than one beat", () => {
    expect(clipTimingError(clip({ beatsPerMeasure: 0 }), 24)).toMatch(/at least 1/);
  });
});

describe("lowestCompatiblePpq", () => {
  it("rounds up to the next multiple of the subdivision", () => {
    expect(lowestCompatiblePpq(clip({ subdivisionPerBeat: 5 }))).toBe(25);
    expect(lowestCompatiblePpq(clip({ subdivisionPerBeat: 7 }))).toBe(28);
    expect(lowestCompatiblePpq(clip({ subdivisionPerBeat: 4 }))).toBe(24);
  });

  it("falls back to a usable suggestion for a degenerate subdivision", () => {
    // The suggestion is shown in an error message, so it must stay a real
    // number even when the clip that provoked the error is nonsense.
    expect(lowestCompatiblePpq(clip({ subdivisionPerBeat: 0 }))).toBe(24);
    expect(lowestCompatiblePpq(clip({ subdivisionPerBeat: Number.NaN }))).toBe(24);
  });
});

describe("starter pattern", () => {
  it("is a valid 4/4 bar of sixteenths", () => {
    const [drums] = fourOnTheFloor().clips;
    expect(drums).toBeDefined();
    expect(clipTimingError(drums!, MIDI_CLOCK_PPQ)).toBeNull();
    expect(stepsPerLoop(drums!)).toBe(16);
  });

  it("puts the kick on every beat and the snare on 2 and 4", () => {
    const [drums] = fourOnTheFloor().clips;
    const notes = (instrument: string) =>
      Object.keys(
        drums!.lanes.find((lane) => lane.instrument === instrument)!.steps
      ).map(Number);

    expect(notes("kick")).toEqual([0, 4, 8, 12]);
    expect(notes("snare")).toEqual([4, 12]);
    expect(notes("closed hihat")).toHaveLength(16);
  });

  it("uses the General MIDI drum channel", () => {
    expect(fourOnTheFloor().clips[0]?.channel).toBe(10);
  });
});

describe("factories", () => {
  it("creates an empty lane with no steps", () => {
    expect(emptyLane().steps).toEqual({});
  });

  it("creates a clip that is immediately playable", () => {
    expect(clipTimingError(emptyClip("New", 1), MIDI_CLOCK_PPQ)).toBeNull();
  });
});
