import type { Cast, Proc, Self } from "@nonchalant/core";
import type {
  MidiDirectory,
  MidiOut,
  MidiPermission,
  MidiPorts,
  OutputInfo,
} from "./ports";

/**
 * Getting to a MIDI output: permission, the port list, the selection, and -
 * the part that matters - the *lifetime* of the writer.
 *
 * ## Why permission is a state and not a step
 *
 * Browsers prompt for MIDI access whether or not sysex is asked for, and they
 * are entitled to suppress a prompt no interaction asked for. A request fired
 * on page load can therefore hang forever or be refused on the user's behalf,
 * and either way the app looks broken while nothing at all is happening.
 *
 * So the process asks what *would* happen before it asks for anything. Already
 * granted, it proceeds on its own; otherwise it stops at `"prompt"` and waits
 * for someone to press a button. Every stage is a status the view can show,
 * because "nothing is happening yet" is a thing the user needs told.
 *
 * ## Why the writer's lifetime lives here
 *
 * Choosing a different output must silence the old one and start writing to the
 * new one. Under a framework that re-runs views this is usually arranged by
 * forcing a keyed remount and letting cleanup fire. Views here run once, so
 * that lever does not exist, and it turns out not to be needed: lifetime is the
 * process's business, stated once in `select`, and no rendering decision can
 * accidentally change it.
 *
 * Nothing here knows the word "MIDIAccess". It talks to a {@link MidiPorts}.
 */

export type MidiStatus =
  /** Working out what this environment can do. */
  | "idle"
  /** No MIDI here at all. */
  | "unsupported"
  /** Access needs asking for, and a person should be the one to ask. */
  | "prompt"
  /** Asked; the browser's own prompt is up. */
  | "asking"
  | "denied"
  | "ready";

export interface MidiState {
  status: MidiStatus;
  /** Why access was refused. Empty unless `status` is `"denied"`. */
  message: string;
  outputs: OutputInfo[];
  /**
   * Input ports, which seq never plays through. Carried so the view can tell
   * "no MIDI at all" apart from "this device is here but its output is not".
   */
  inputs: OutputInfo[];
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
  /** Ask for access. Should come from a user gesture wherever it can. */
  | Cast<{ type: "request" }>
  | Cast<{ type: "select"; id: string }>
  /** Look again, for a device that arrived without announcing itself. */
  | Cast<{ type: "rescan" }>
  /** What the environment said it would do. */
  | Cast<{ type: "checked"; permission: MidiPermission }>
  /** Access resolved. Cast back into the mailbox rather than awaited inline. */
  | Cast<{ type: "granted"; directory: MidiDirectory }>
  | Cast<{ type: "denied"; message: string }>
  /** A device was plugged in or pulled out. */
  | Cast<{ type: "ports_changed" }>;

const REFUSED_BEFORE =
  "This site is blocked from using MIDI. Allow it in the browser's site settings for this page, then try again.";

const why = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const midiProc = (ports: MidiPorts): Proc<MidiState, MidiMsg, void> =>
  async function* (self: Self<MidiMsg>) {
    let status: MidiStatus = "idle";
    let message = "";
    let outputs: OutputInfo[] = [];
    let inputs: OutputInfo[] = [];
    let selectedId = "";
    let send: MidiOut | undefined;

    /** Live, and of no interest to anyone outside: not state. */
    let directory: MidiDirectory | undefined;
    let unwatch: (() => void) | undefined;

    const state = (): MidiState => ({
      status,
      message,
      outputs,
      inputs,
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

    const ask = () => {
      ports.open().then(
        (granted) => self.cast({ type: "granted", directory: granted }),
        (error: unknown) => self.cast({ type: "denied", message: why(error) })
      );
    };

    try {
      yield state();

      if (!ports.available()) {
        status = "unsupported";
        yield state();
      } else {
        ports
          .permission()
          .then((permission) => self.cast({ type: "checked", permission }));
      }

      for await (const msg of self) {
        switch (msg.type) {
          case "checked": {
            if (msg.permission === "granted") {
              // Already allowed: no prompt will appear, so there is nothing for
              // a gesture to protect and waiting for one would only annoy.
              status = "asking";
              ask();
            } else if (msg.permission === "denied") {
              status = "denied";
              message = REFUSED_BEFORE;
            } else {
              status = "prompt";
            }
            break;
          }

          case "request": {
            if (status === "asking" || status === "ready") continue;
            status = "asking";
            message = "";
            ask();
            break;
          }

          case "granted": {
            directory = msg.directory;
            unwatch?.();
            unwatch = directory.onChange(() =>
              self.cast({ type: "ports_changed" })
            );
            outputs = directory.list();
            inputs = directory.inputs();
            status = "ready";
            break;
          }

          case "denied": {
            status = "denied";
            message = msg.message;
            break;
          }

          case "rescan":
          case "ports_changed": {
            if (directory === undefined) continue;
            outputs = directory.list();
            inputs = directory.inputs();
            // A port can disappear while selected (cable pulled, app closed).
            // Drop the writer rather than keep addressing a dead port.
            if (selectedId !== "" && !outputs.some((o) => o.id === selectedId)) {
              point("");
            }
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
