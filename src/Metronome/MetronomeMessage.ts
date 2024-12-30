export type Input =
  | { type: "set_bpm"; bpm: number }
  | { type: "set_ppq"; ppq: number }
  | { type: "set_pattern"; pattern: Record<number, number[]> }
  | { type: "start" }
  | { type: "stop" };

export type Output =
  | {
      type: "tick";
      time: number;
      playhead: number;
      pulse: number;
    }
  | { type: "step"; stepIndex: number; currentTime: number }
  | { type: "initial" }
  | { type: "started" }
  | { type: "stopped" }
  | {
      type: "note_on";
      channel: number;
      note: number;
      velocity: number;
      time: number;
    }
  | {
      type: "note_off";
      channel: number;
      note: number;
      time: number;
    };
