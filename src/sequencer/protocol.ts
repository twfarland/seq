import type { Pattern } from "./pattern";

/**
 * The message contract between the UI thread and the sequencer worker.
 *
 * All timestamps in this file are **worker-clock** milliseconds
 * (`performance.now()` inside the worker). A dedicated worker has its own
 * `timeOrigin`, so these are NOT directly comparable to the document's clock —
 * `createSequencerPort` translates them. See `port.ts`.
 */

export type SequencerCommand =
  | { type: "set_bpm"; bpm: number }
  | { type: "set_ppq"; ppq: number }
  | { type: "set_pattern"; pattern: Pattern }
  | { type: "start" }
  | { type: "stop" }
  /** Silence everything immediately without changing transport state. */
  | { type: "panic" };

/**
 * Emitted once, unprompted, as soon as the worker module evaluates. Carries the
 * worker's `performance.timeOrigin` so the UI thread can convert every
 * subsequent timestamp into its own clock domain.
 */
export interface ReadyEvent {
  type: "ready";
  timeOrigin: number;
}

export type SequencerEvent =
  | ReadyEvent
  | { type: "started"; time: number }
  | { type: "stopped"; time: number }
  /** MIDI clock pulse (0xF8). One per PPQ subdivision while running. */
  | { type: "tick"; time: number; pulse: number }
  /** Playhead moved. UI-only; carries no MIDI meaning. */
  | { type: "step"; clipIndex: number; stepIndex: number; time: number }
  | {
      type: "note_on";
      channel: number;
      midiNote: number;
      velocity: number;
      time: number;
    }
  | { type: "note_off"; channel: number; midiNote: number; time: number };
