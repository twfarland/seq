import { spawn } from "@nonchalant/core";
import { mount } from "@nonchalant/dom";
import { webMidi } from "./adapters/midi";
import { documentOrigin, frames } from "./adapters/browser";
import { workerChannel } from "./adapters/worker/channel";
import { midiProc, type MidiState } from "./app/outputs";
import { createSession } from "./app/session";
import { App } from "./ui/App";
import "./styles.css";

/**
 * The composition root: the one place that decides which adapter fills which
 * port, and the only file that both `app/` and `adapters/` are allowed to meet
 * in. Everything below it is written against interfaces.
 */

const root = document.getElementById("app");
if (!root) throw new Error("#app element is missing from index.html");

const midi = spawn(midiProc(webMidi), undefined, {
  initial: {
    status: "idle",
    message: "",
    outputs: [],
    inputs: [],
    selectedId: "",
    send: undefined,
  } satisfies MidiState,
});

const session = createSession({
  channel: workerChannel(),
  // Read per event batch rather than captured, so changing the output device
  // needs no rewiring: the session asks who is listening each time.
  output: () => midi().send,
  frames,
  documentOrigin: documentOrigin(),
});

mount(root, App(midi, session));

// Terminating the worker strands every sounding note, and a queued "stop"
// would never be processed.
addEventListener("beforeunload", () => {
  session[Symbol.dispose]();
  midi[Symbol.dispose]();
});
