import type { Process, VNode } from "@nonchalant/core";
import { h1, main, p } from "@nonchalant/dom/tags";
import type { Session } from "~/app/session";
import type { MidiMsg, MidiState } from "~/app/outputs";
import { MidiOutputPicker } from "./MidiOutputPicker";
import { SequencerControl } from "./SequencerControl";

/**
 * The shell.
 *
 * The sequencer appears once an output is chosen. That is a replaceable region
 * rather than a keyed remount: the thunk reads whether a writer exists, so
 * swapping devices rebuilds the editor exactly as before - but the worker, the
 * pattern it holds, and the transport all survive the swap, because their
 * lifetime belongs to a process now rather than to a piece of the view.
 */
export function App(
  midi: Process<MidiState, MidiMsg>,
  session: Session
): VNode {
  return main(
    { class: "app" },
    h1({}, "seq"),
    p({ class: "app__tagline" }, "A MIDI step sequencer with a worker-driven clock."),
    MidiOutputPicker(midi),
    () => (midi().send ? SequencerControl(session, midi) : null)
  );
}
