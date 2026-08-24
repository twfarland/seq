/**
 * What the engine produces: a stream of things that should happen, each stamped
 * with the moment it should happen at.
 *
 * These are the domain's output vocabulary, not a transport format. The engine
 * decides *what* and *when*; who turns them into bytes, and on which clock, is
 * somebody else's problem entirely.
 *
 * Times are milliseconds on whatever clock was handed to the engine. In this
 * app that is the worker's `performance.now()`, which is not the document's -
 * see `app/session.ts`, which is the only place that knows the difference.
 */
export type SequencerEvent =
  | { type: "started"; time: number }
  | { type: "stopped"; time: number }
  /** MIDI clock pulse (0xF8). One per PPQ subdivision while running. */
  | { type: "tick"; time: number; pulse: number }
  /** Playhead moved. Display only; carries no MIDI meaning. */
  | { type: "step"; clipIndex: number; stepIndex: number; time: number }
  | {
      type: "note_on";
      channel: number;
      midiNote: number;
      velocity: number;
      time: number;
    }
  | { type: "note_off"; channel: number; midiNote: number; time: number };
