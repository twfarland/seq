export type Input =
  | { type: "set_bpm"; bpm: number }
  | { type: "set_ppq"; ppq: number }
  | { type: "start" }
  | { type: "stop" };

export type Output =
  | {
      type: "tick";
      time: number;
      playhead: number;
      pulse: number;
    }
  | { type: "initial" }
  | { type: "started" }
  | { type: "stopped" };
