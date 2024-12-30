import { Pattern } from "./Pattern";

export type Input =
  | { type: "set_bpm"; bpm: number }
  | { type: "set_ppq"; ppq: number }
  | { type: "set_pattern"; pattern: Pattern }
  | { type: "start" }
  | { type: "stop" };
// TODO patch pattern (json patch?)

export type Output =
  | { type: "initial" }
  | { type: "started" }
  | { type: "stopped" }
  | {
      type: "tick";
      time: number;
      pulse: number;
    }
  | {
      type: "step";
      clipIndex: number;
      stepIndex: number;
      time: number;
    }
  | {
      type: "note_on";
      channel: number;
      midiNote: number;
      velocity: number;
      time: number;
    }
  | {
      type: "note_off";
      channel: number;
      note: number;
      time: number;
    };
