import {
  BPM_RANGE,
  MIDI_CLOCK_PPQ,
  PPQ_RANGE,
  VELOCITY_RANGE,
  clamp,
  pulseIntervalMs,
  pulsesPerStep,
  stepsPerLoop,
  type Pattern,
} from "./pattern";
import type { SequencerEvent } from "./protocol";

/**
 * The sequencer core: a pure state machine that turns wall-clock time into an
 * ordered stream of MIDI/UI events.
 *
 * It owns no timer and touches no global. Time only moves when a caller passes
 * a timestamp to {@link SequencerEngine.advance}, which is what makes the whole
 * timing model testable with a fake clock (see `engine.test.ts`).
 *
 * ## Scheduling model
 *
 * This is the "tale of two clocks" pattern. A coarse timer wakes the engine
 * every few milliseconds; each wake-up emits every pulse falling inside a
 * lookahead window and stamps it with its *ideal* time, not the time it was
 * computed. Web MIDI honours those future timestamps and delivers the bytes
 * with sub-millisecond accuracy, so `setTimeout` jitter never reaches the wire.
 */
export interface SequencerEngine {
  setBpm(bpm: number): void;
  setPpq(ppq: number): void;
  setPattern(pattern: Pattern): void;

  /** Begin playback at `now`. Emits `started` and the downbeat's events. */
  start(now: number): SequencerEvent[];
  /** Halt playback, releasing every sounding note so nothing hangs. */
  stop(now: number): SequencerEvent[];
  /** Release every sounding note without changing transport state. */
  panic(now: number): SequencerEvent[];
  /** Emit everything due up to `now + lookahead`. Safe to call when stopped. */
  advance(now: number): SequencerEvent[];

  /** Timestamp the engine next has work to do, or `null` when stopped. */
  nextDeadline(): number | null;
  isRunning(): boolean;
  /** Pulses emitted since `start`. Exposed for tests and diagnostics. */
  currentPulse(): number;
}

export interface SequencerEngineOptions {
  /**
   * How far past `now` to emit events. Must comfortably exceed the timer
   * interval driving `advance`, or pulses arrive late and audibly jitter.
   */
  lookaheadMs?: number;
  /**
   * Ceiling on pulses emitted by a single `advance` call. When a tab is
   * backgrounded, timers are throttled to roughly 1Hz; without this cap the
   * first wake-up would try to replay every missed pulse at once and flood the
   * MIDI port. Exceeding it resyncs the grid to `now` instead.
   */
  maxCatchUpPulses?: number;
}

/** A note that has sounded and still owes a note-off. */
interface ActiveNote {
  channel: number;
  midiNote: number;
  /**
   * Pulse at which this note must be released.
   *
   * Deliberately a pulse count rather than a timestamp: comparing accumulated
   * floating-point milliseconds made a gate that should end exactly on a pulse
   * land one pulse late about half the time. Integer pulses are exact, and they
   * also make gate lengths follow a mid-note tempo change musically.
   */
  offPulse: number;
}

const EMPTY_PATTERN: Pattern = { name: "empty", clips: [] };

export function createSequencerEngine(
  options: SequencerEngineOptions = {}
): SequencerEngine {
  const lookaheadMs = options.lookaheadMs ?? 120;
  const maxCatchUpPulses = options.maxCatchUpPulses ?? 96;

  let bpm = 120;
  let ppq = MIDI_CLOCK_PPQ;
  let pattern: Pattern = EMPTY_PATTERN;
  let running = false;
  /** Index of the next pulse to emit. */
  let pulse = 0;
  let activeNotes: ActiveNote[] = [];

  /**
   * Pulse times are derived from an anchor rather than accumulated one interval
   * at a time: `anchorTime` is the exact instant `anchorPulse` falls on, and
   * every other pulse is a single multiplication away. Accumulating instead
   * lets rounding error compound over thousands of pulses.
   *
   * A tempo or resolution change re-anchors at the current pulse, so pulses
   * already scheduled keep their times and only later ones adopt the new rate.
   */
  let anchorPulse = 0;
  let anchorTime = 0;

  const interval = () => pulseIntervalMs(bpm, ppq);
  const timeOfPulse = (index: number) =>
    anchorTime + (index - anchorPulse) * interval();

  const reanchor = () => {
    anchorTime = timeOfPulse(pulse);
    anchorPulse = pulse;
  };

  /** Queue a note-off for `note`. Callers own removal from `activeNotes`. */
  const releaseNote = (
    note: ActiveNote,
    time: number,
    out: SequencerEvent[]
  ) => {
    out.push({
      type: "note_off",
      channel: note.channel,
      midiNote: note.midiNote,
      time,
    });
  };

  const flushNoteOffsDueAt = (
    atPulse: number,
    time: number,
    out: SequencerEvent[]
  ) => {
    if (activeNotes.length === 0) return;
    const stillSounding: ActiveNote[] = [];
    for (const note of activeNotes) {
      if (note.offPulse <= atPulse) releaseNote(note, time, out);
      else stillSounding.push(note);
    }
    activeNotes = stillSounding;
  };

  const releaseAll = (time: number, out: SequencerEvent[]) => {
    for (const note of activeNotes) releaseNote(note, time, out);
    activeNotes = [];
  };

  /** Emit step markers and note-ons for every clip landing on the current pulse. */
  const emitStepEvents = (time: number, out: SequencerEvent[]) => {
    for (const [clipIndex, clip] of pattern.clips.entries()) {
      const stepPulses = pulsesPerStep(clip, ppq);
      // A clip whose subdivision does not divide PPQ has no representable grid;
      // skip it rather than rounding its notes onto the wrong beats.
      if (stepPulses === null || pulse % stepPulses !== 0) continue;

      const loopLength = stepsPerLoop(clip);
      // Each clip wraps at its own length, so clips of differing bar lengths
      // drift against each other - that is the intended polymetric behaviour.
      const stepIndex = (pulse / stepPulses) % loopLength;

      out.push({ type: "step", clipIndex, stepIndex, time });

      for (const lane of clip.lanes) {
        const step = lane.steps[stepIndex];
        if (!step) continue;

        const channel = clamp(Math.round(clip.channel), 1, 16);
        const midiNote = clamp(Math.round(lane.midiNote), 0, 127);

        // Retriggering a note that is still sounding must release it first.
        // Otherwise the earlier note-off arrives mid-way through the new note,
        // cutting it short and leaving the second note-off unmatched.
        const sounding = activeNotes.findIndex(
          (n) => n.channel === channel && n.midiNote === midiNote
        );
        if (sounding !== -1) {
          releaseNote(activeNotes[sounding]!, time, out);
          activeNotes.splice(sounding, 1);
        }

        out.push({
          type: "note_on",
          time,
          channel,
          midiNote,
          velocity: clamp(
            Math.round(step.velocity),
            VELOCITY_RANGE.min,
            VELOCITY_RANGE.max
          ),
        });

        // Gate length counts this clip's own steps, so `lengthInSteps: 1` means
        // "one of my steps" whether the clip runs in 1/8ths or 1/16ths.
        const gateSteps = Math.max(1, Math.round(step.lengthInSteps) || 1);
        activeNotes.push({
          channel,
          midiNote,
          offPulse: pulse + stepPulses * gateSteps,
        });
      }
    }
  };

  const engine: SequencerEngine = {
    setBpm(next) {
      const clamped = clamp(next, BPM_RANGE.min, BPM_RANGE.max);
      if (clamped === bpm) return;
      // Re-anchor before the rate changes, so already-scheduled pulses are not
      // retroactively moved by the new interval.
      reanchor();
      bpm = clamped;
    },

    setPpq(next) {
      const clamped = Math.round(clamp(next, PPQ_RANGE.min, PPQ_RANGE.max));
      if (clamped === ppq) return;
      reanchor();
      ppq = clamped;
    },

    setPattern(next) {
      pattern = next;
    },

    start(now) {
      if (running) return [];
      running = true;
      pulse = 0;
      activeNotes = [];
      anchorPulse = 0;
      anchorTime = now;

      // MIDI Start (0xFA) must precede the first clock pulse, so it is emitted
      // before `advance` produces anything.
      const out: SequencerEvent[] = [{ type: "started", time: now }];
      out.push(...engine.advance(now));
      return out;
    },

    stop(now) {
      if (!running) return [];
      running = false;
      const out: SequencerEvent[] = [];
      // Release before announcing the stop: a receiver that reacts to 0xFC by
      // muting would otherwise swallow the note-offs and hang the notes.
      releaseAll(now, out);
      out.push({ type: "stopped", time: now });
      return out;
    },

    panic(now) {
      const out: SequencerEvent[] = [];
      releaseAll(now, out);
      return out;
    },

    advance(now) {
      if (!running) return [];

      const out: SequencerEvent[] = [];
      const horizon = now + lookaheadMs;
      let emitted = 0;

      while (timeOfPulse(pulse) <= horizon && emitted < maxCatchUpPulses) {
        const time = timeOfPulse(pulse);

        // Note-offs first, so a note ending exactly where the next begins is
        // released before the retrigger check in `emitStepEvents` runs.
        flushNoteOffsDueAt(pulse, time, out);
        emitStepEvents(time, out);
        out.push({ type: "tick", time, pulse });

        pulse++;
        emitted++;
      }

      if (emitted >= maxCatchUpPulses && timeOfPulse(pulse) <= horizon) {
        // Too far behind to catch up musically (backgrounded tab, long GC).
        // Drop the backlog and realign the grid to the present.
        anchorPulse = pulse;
        anchorTime = now;
      }

      return out;
    },

    nextDeadline() {
      return running ? timeOfPulse(pulse) - lookaheadMs : null;
    },

    isRunning() {
      return running;
    },

    currentPulse() {
      return pulse;
    },
  };

  return engine;
}
