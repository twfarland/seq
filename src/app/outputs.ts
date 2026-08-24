import type { Cast, Proc, Self } from "@nonchalant/core";
import type {
  MidiDirectory,
  MidiOut,
  MidiPorts,
  OutputInfo,
} from "./ports";

/**
 * Choosing where to play: permission, the port list, and - the part that
 * matters - the *lifetime* of the writer.
 *
 * Choosing a different output must silence the old one and start writing to the
 * new one. Under a framework that re-runs views this is usually arranged by
 * forcing a keyed remount and letting cleanup fire. Views here run once, so
 * that lever does not exist, and it turns out not to be needed: lifetime is the
 * process's business, stated once in `select`, and no rendering decision can
 * accidentally change it.
 *
 * Nothing here knows the word "MIDIAccess". It talks to a {@link MidiPorts},
 * which happens to be Web MIDI in the browser and a plain object in tests.
 */

export type MidiStatus = "idle" | "unsupported" | "denied" | "ready";

export interface MidiState {
  status: MidiStatus;
  /** Why access was refused. Empty unless `status` is `"denied"`. */
  message: string;
  outputs: OutputInfo[];
  /** `""` when nothing is chosen. */
  selectedId: string;
  /**
   * The writer for the selected port, or `undefined`.
   *
   * Not plain data, so nonchalant tracks it as an atomic leaf: reads hand it
   * back untouched and changes compare by identity. That is exactly right here,
   * and it is also why this process can never be remote - which it never could
   * be anyway, since the hardware is on this thread.
   */
  send: MidiOut | undefined;
}

export type MidiMsg =
  | Cast<{ type: "select"; id: string }>
  /** Access resolved. Cast back into the mailbox rather than awaited inline. */
  | Cast<{ type: "granted"; directory: MidiDirectory }>
  | Cast<{ type: "denied"; message: string }>
  /** A device was plugged in or pulled out. */
  | Cast<{ type: "ports_changed" }>;

export const midiProc = (ports: MidiPorts): Proc<MidiState, MidiMsg, void> =>
  async function* (self: Self<MidiMsg>) {
    let status: MidiStatus = "idle";
    let message = "";
    let outputs: OutputInfo[] = [];
    let selectedId = "";
    let send: MidiOut | undefined;

    /** Live, and of no interest to anyone outside: not state. */
    let directory: MidiDirectory | undefined;
    let unwatch: (() => void) | undefined;

    const state = (): MidiState => ({
      status,
      message,
      outputs,
      selectedId,
      send,
    });

    /** Point the writer at `id`, silencing whatever it was writing to before. */
    const point = (id: string) => {
      send?.panic();
      const opened = id === "" ? undefined : directory?.open(id);
      selectedId = opened ? id : "";
      send = opened;
    };

    try {
      yield state();

      const request = ports.open();
      if (request === undefined) {
        status = "unsupported";
        yield state();
      } else {
        request.then(
          (granted) => self.cast({ type: "granted", directory: granted }),
          (error: unknown) =>
            self.cast({
              type: "denied",
              message: error instanceof Error ? error.message : String(error),
            })
        );
      }

      for await (const msg of self) {
        switch (msg.type) {
          case "granted": {
            directory = msg.directory;
            unwatch = directory.onChange(() =>
              self.cast({ type: "ports_changed" })
            );
            outputs = directory.list();
            status = "ready";
            break;
          }

          case "denied": {
            status = "denied";
            message = msg.message;
            break;
          }

          case "ports_changed": {
            if (directory === undefined) continue;
            outputs = directory.list();
            // A port can disappear while selected (cable pulled, app closed).
            // Drop the writer rather than keep addressing a dead port.
            if (!outputs.some((output) => output.id === selectedId)) point("");
            break;
          }

          case "select": {
            if (msg.id === selectedId) continue;
            point(msg.id);
            break;
          }
        }

        yield state();
      }
    } finally {
      unwatch?.();
      send?.panic();
    }
  };
