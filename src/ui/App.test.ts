import { spawn } from "@nonchalant/core";
import { afterEach, describe, expect, it } from "vitest";
import { midiProc, type MidiState } from "~/app/outputs";
import type { MidiPorts } from "~/app/ports";
import { createSession, type Session } from "~/app/session";
import {
  fakeMidiPorts,
  manualFrames,
  memoryChannel,
  noMidiPorts,
} from "~/test/fakes";
import { render, settle } from "~/test/render";
import { App } from "./App";

const initial: MidiState = {
  status: "idle",
  message: "",
  outputs: [],
  selectedId: "",
  send: undefined,
};

const disposers: (() => void)[] = [];

async function app(ports: MidiPorts) {
  const channel = memoryChannel();
  const midi = spawn(midiProc(ports), undefined, { initial });
  const session: Session = createSession({
    channel: channel.channel,
    output: () => midi().send,
    frames: manualFrames().arm,
    documentOrigin: 0,
  });

  const view = render(App(midi, session));
  disposers.push(() => {
    view[Symbol.dispose]();
    session[Symbol.dispose]();
    midi[Symbol.dispose]();
  });

  await channel.settle();
  await settle();
  return { midi, container: view.container, channel };
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe("App", () => {
  it("renders the shell and degrades gracefully without Web MIDI", async () => {
    const { container } = await app(noMidiPorts);

    expect(container.querySelector("h1")?.textContent).toBe("seq");
    expect(container.textContent).toContain("does not support the Web MIDI API");
    // Nothing to play through, so no sequencer.
    expect(container.querySelector(".sequencer")).toBeNull();
  });

  it("reveals the sequencer once an output is chosen", async () => {
    const devices = fakeMidiPorts();
    const { midi, container, channel } = await app(devices.ports);

    expect(container.querySelector(".sequencer")).toBeNull();

    midi.cast({ type: "select", id: devices.firstId });
    await channel.settle();
    await settle();

    expect(container.querySelector(".sequencer")).not.toBeNull();
    expect(container.querySelectorAll(".step").length).toBeGreaterThan(0);
  });
});
