import { describe, expect, it } from "vitest";
import { createSequencerEngine, type SequencerEngine } from "./engine";
import { MIDI_CLOCK_PPQ, pulseIntervalMs, type Clip, type Pattern } from "./pattern";
import type { SequencerEvent } from "./protocol";

const BPM = 120;
/** 120bpm at 24ppq => 20.833…ms per pulse. */
const PULSE_MS = pulseIntervalMs(BPM, MIDI_CLOCK_PPQ);

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    name: "Test",
    channel: 1,
    beatsPerMeasure: 4,
    subdivisionPerBeat: 4,
    lanes: [],
    ...overrides,
  };
}

function pattern(...clips: Clip[]): Pattern {
  return { name: "Test", clips };
}

/** An engine with no lookahead, so `advance(t)` emits exactly what is due at t. */
function makeEngine(p?: Pattern): SequencerEngine {
  const engine = createSequencerEngine({ lookaheadMs: 0 });
  engine.setBpm(BPM);
  engine.setPpq(MIDI_CLOCK_PPQ);
  if (p) engine.setPattern(p);
  return engine;
}

const only = <T extends SequencerEvent["type"]>(
  events: SequencerEvent[],
  type: T
) => events.filter((e): e is Extract<SequencerEvent, { type: T }> => e.type === type);

/**
 * Run the engine from t=0 to `untilMs`, polling every `stepMs`.
 *
 * The final poll always lands exactly on `untilMs` so an uneven `stepMs` does
 * not silently shorten the run and change the expected pulse count.
 */
function runFor(engine: SequencerEngine, untilMs: number, stepMs = 5) {
  const events = engine.start(0);
  for (let t = stepMs; t < untilMs; t += stepMs) {
    events.push(...engine.advance(t));
  }
  events.push(...engine.advance(untilMs));
  return events;
}

describe("transport", () => {
  it("emits started before the first clock pulse", () => {
    const events = makeEngine(pattern()).start(0);
    expect(events[0]?.type).toBe("started");
    expect(events[1]?.type).toBe("tick");
  });

  it("fires the downbeat immediately rather than one pulse late", () => {
    const engine = makeEngine(pattern());
    const ticks = only(engine.start(0), "tick");
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({ pulse: 0, time: 0 });
  });

  it("ignores a second start and a stop when already stopped", () => {
    const engine = makeEngine(pattern());
    engine.start(0);
    expect(engine.start(50)).toEqual([]);
    engine.stop(50);
    expect(engine.stop(60)).toEqual([]);
  });

  it("restarts the pulse counter on each start", () => {
    const engine = makeEngine(pattern());
    runFor(engine, 200);
    expect(engine.currentPulse()).toBeGreaterThan(1);
    engine.stop(200);
    engine.start(200);
    expect(engine.currentPulse()).toBe(1); // pulse 0 fired, counter advanced
  });
});

describe("clock rate", () => {
  // The original implementation recomputed its elapsed time before advancing
  // the reference point, which emitted pulses in pairs. This pins the rate.
  it("emits exactly one pulse per interval regardless of polling rate", () => {
    for (const stepMs of [1, 5, 7, 20]) {
      const engine = makeEngine(pattern());
      const oneSecond = runFor(engine, 1000, stepMs);
      // 120bpm * 24ppq = 48 pulses/sec; the pulse at t=0 makes 49 by t=1000.
      expect(only(oneSecond, "tick")).toHaveLength(49);
    }
  });

  it("keeps absolute pulse times on the ideal grid, without drift", () => {
    const engine = makeEngine(pattern());
    const ticks = only(runFor(engine, 2000, 3), "tick");
    for (const tick of ticks) {
      expect(tick.time).toBeCloseTo(tick.pulse * PULSE_MS, 6);
    }
  });

  it("halves the pulse interval when tempo doubles", () => {
    const engine = makeEngine(pattern());
    engine.setBpm(240);
    const ticks = only(runFor(engine, 1000, 5), "tick");
    expect(only(ticks, "tick")).toHaveLength(97);
  });

  it("clamps a nonsensical tempo instead of hanging", () => {
    // A 0 or negative interval used to make the catch-up loop run forever.
    for (const bad of [0, -120, Number.NaN]) {
      const engine = makeEngine(pattern());
      engine.setBpm(bad);
      const ticks = only(runFor(engine, 1000, 10), "tick");
      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks.length).toBeLessThan(500);
    }
  });
});

describe("catch-up", () => {
  it("replays pulses missed during a short stall", () => {
    const engine = makeEngine(pattern());
    const events = engine.start(0);
    // Nothing polls for 200ms - roughly 9.6 pulses' worth.
    events.push(...engine.advance(200));
    expect(only(events, "tick")).toHaveLength(Math.floor(200 / PULSE_MS) + 1);
  });

  it("resyncs instead of flooding after a long background stall", () => {
    const engine = createSequencerEngine({
      lookaheadMs: 0,
      maxCatchUpPulses: 96,
    });
    engine.setBpm(BPM);
    engine.start(0);
    // Five minutes throttled in a background tab would be ~14,400 pulses.
    const events = engine.advance(300_000);
    expect(only(events, "tick")).toHaveLength(96);
    // The grid realigns to the present rather than staying 5 minutes behind.
    expect(engine.nextDeadline()).toBeCloseTo(300_000, 6);
  });
});

describe("note scheduling", () => {
  const kick = clip({
    channel: 10,
    lanes: [
      {
        instrument: "kick",
        midiNote: 36,
        steps: { 0: { velocity: 100, lengthInSteps: 1 } },
      },
    ],
  });

  it("plays a step on the downbeat with the right channel and velocity", () => {
    const engine = makeEngine(pattern(kick));
    const [noteOn] = only(engine.start(0), "note_on");
    expect(noteOn).toMatchObject({
      channel: 10,
      midiNote: 36,
      velocity: 100,
      time: 0,
    });
  });

  it("releases the note after exactly one step", () => {
    const engine = makeEngine(pattern(kick));
    const events = runFor(engine, 500, 1);
    const [noteOff] = only(events, "note_off");
    // A sixteenth at 120bpm lasts 125ms.
    expect(noteOff?.time).toBeCloseTo(125, 6);
  });

  it("honours multi-step gate lengths", () => {
    const long = clip({
      lanes: [
        {
          instrument: "pad",
          midiNote: 60,
          steps: { 0: { velocity: 100, lengthInSteps: 4 } },
        },
      ],
    });
    const events = runFor(makeEngine(pattern(long)), 1000, 1);
    expect(only(events, "note_off")[0]?.time).toBeCloseTo(500, 6);
  });

  it("loops the clip, retriggering on every pass", () => {
    // 4/4 of sixteenths at 120bpm is a 2s bar. Run just past the third
    // downbeat rather than exactly on it, so the assertion does not hinge on
    // which side of t=4000 a floating-point pulse time lands.
    const events = runFor(makeEngine(pattern(kick)), 4100, 2);
    expect(only(events, "note_on")).toHaveLength(3);
  });

  it("releases a sounding note before retriggering the same pitch", () => {
    const sustained = clip({
      lanes: [
        {
          instrument: "pad",
          midiNote: 60,
          // Overlapping gates: each step lasts 4 steps but fires every step.
          steps: Object.fromEntries(
            Array.from({ length: 16 }, (_, i) => [
              i,
              { velocity: 100, lengthInSteps: 4 },
            ])
          ),
        },
      ],
    });
    const events = runFor(makeEngine(pattern(sustained)), 1000, 1);
    const midi = events.filter(
      (e) => e.type === "note_on" || e.type === "note_off"
    );
    // Every note_on must be preceded by a matching release, so the stream
    // strictly alternates and no note is left hanging.
    let sounding = false;
    for (const event of midi) {
      if (event.type === "note_on") {
        expect(sounding).toBe(false);
        sounding = true;
      } else {
        expect(sounding).toBe(true);
        sounding = false;
      }
    }
  });

  it("clamps out-of-range channel, note and velocity", () => {
    const wild = clip({
      channel: 99,
      lanes: [
        {
          instrument: "x",
          midiNote: 900,
          steps: { 0: { velocity: 9000, lengthInSteps: 1 } },
        },
      ],
    });
    const [noteOn] = only(makeEngine(pattern(wild)).start(0), "note_on");
    expect(noteOn).toMatchObject({ channel: 16, midiNote: 127, velocity: 127 });
  });
});

describe("stopping", () => {
  it("releases every sounding note so nothing hangs", () => {
    const held = clip({
      lanes: [
        {
          instrument: "pad",
          midiNote: 60,
          steps: { 0: { velocity: 100, lengthInSteps: 16 } },
        },
      ],
    });
    const engine = makeEngine(pattern(held));
    engine.start(0);
    const events = engine.stop(100);
    expect(only(events, "note_off")).toHaveLength(1);
    // The release must precede the MIDI Stop byte.
    expect(events.map((e) => e.type)).toEqual(["note_off", "stopped"]);
  });

  it("does not re-release the same note twice", () => {
    const held = clip({
      lanes: [
        {
          instrument: "pad",
          midiNote: 60,
          steps: { 0: { velocity: 100, lengthInSteps: 16 } },
        },
      ],
    });
    const engine = makeEngine(pattern(held));
    engine.start(0);
    engine.stop(100);
    engine.start(200);
    expect(only(engine.stop(210), "note_off")).toHaveLength(1);
  });

  it("panics without changing transport state", () => {
    const held = clip({
      lanes: [
        {
          instrument: "pad",
          midiNote: 60,
          steps: { 0: { velocity: 100, lengthInSteps: 16 } },
        },
      ],
    });
    const engine = makeEngine(pattern(held));
    engine.start(0);
    expect(only(engine.panic(50), "note_off")).toHaveLength(1);
    expect(engine.isRunning()).toBe(true);
  });

  it("emits nothing once stopped", () => {
    const engine = makeEngine(pattern(clip()));
    engine.start(0);
    engine.stop(10);
    expect(engine.advance(5000)).toEqual([]);
    expect(engine.nextDeadline()).toBeNull();
  });
});

describe("polymeter", () => {
  it("loops clips of different lengths independently", () => {
    const three = clip({
      name: "3/4",
      channel: 1,
      beatsPerMeasure: 3,
      subdivisionPerBeat: 4,
      lanes: [],
    });
    const four = clip({ name: "4/4", channel: 2, lanes: [] });
    const events = runFor(makeEngine(pattern(three, four)), 4000, 2);

    const stepsOf = (index: number) =>
      only(events, "step")
        .filter((e) => e.clipIndex === index)
        .map((e) => e.stepIndex);

    expect(Math.max(...stepsOf(0))).toBe(11); // 3 beats * 4 = 12 steps
    expect(Math.max(...stepsOf(1))).toBe(15); // 4 beats * 4 = 16 steps
    // Both clips advance on the same grid, so they emit the same step count.
    expect(stepsOf(0).length).toBe(stepsOf(1).length);
  });

  it("skips a clip whose subdivision does not divide PPQ", () => {
    // Quintuplets are unrepresentable at 24ppq; the clip must fall silent
    // rather than have its notes rounded onto the wrong pulses.
    const quintuplets = clip({
      subdivisionPerBeat: 5,
      lanes: [
        {
          instrument: "x",
          midiNote: 60,
          steps: { 0: { velocity: 100, lengthInSteps: 1 } },
        },
      ],
    });
    const events = runFor(makeEngine(pattern(quintuplets)), 2000, 5);
    expect(only(events, "note_on")).toHaveLength(0);
    expect(only(events, "step")).toHaveLength(0);
    // Raising PPQ to a multiple of 5 makes the same clip playable.
    const engine = makeEngine(pattern(quintuplets));
    engine.setPpq(120);
    expect(only(runFor(engine, 2000, 5), "note_on").length).toBeGreaterThan(0);
  });
});

describe("lookahead", () => {
  it("emits events ahead of the current time, stamped with their ideal time", () => {
    const engine = createSequencerEngine({ lookaheadMs: 100 });
    engine.setBpm(BPM);
    const ticks = only(engine.start(0), "tick");
    // 100ms of lookahead at 20.83ms per pulse covers pulses 0..4.
    expect(ticks).toHaveLength(5);
    expect(ticks.at(-1)?.time).toBeCloseTo(4 * PULSE_MS, 6);
  });

  it("never emits the same pulse twice across successive advances", () => {
    const engine = createSequencerEngine({ lookaheadMs: 100 });
    engine.setBpm(BPM);
    const events = runFor(engine, 2000, 10);
    const pulses = only(events, "tick").map((e) => e.pulse);
    expect(pulses).toEqual([...new Set(pulses)]);
    expect(pulses).toEqual([...pulses].sort((a, b) => a - b));
  });
});
