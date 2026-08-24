import { spawn } from "@nonchalant/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  fakeMidiPorts,
  noMidiPorts,
  refusedMidiPorts,
} from "~/test/fakes";
import { midiProc, type MidiState } from "./outputs";
import type { MidiPorts } from "./ports";

/**
 * Choosing an output. The interesting part is not the port list but the
 * *lifetime* of the writer: choosing a different device has to silence the one
 * being left, and a device that disappears has to take the writer with it.
 */

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const initial: MidiState = {
  status: "idle",
  message: "",
  outputs: [],
  selectedId: "",
  send: undefined,
};

const disposers: (() => void)[] = [];

function harness(ports: MidiPorts) {
  const proc = spawn(midiProc(ports), undefined, { initial });
  disposers.push(() => proc[Symbol.dispose]());
  return proc;
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe("permission", () => {
  it("says so when there is no MIDI here at all", async () => {
    const midi = harness(noMidiPorts);
    await settle();
    expect(midi().status).toBe("unsupported");
  });

  it("surfaces the rejection reason instead of failing silently", async () => {
    const midi = harness(refusedMidiPorts("User denied"));
    await settle();
    expect(midi()).toMatchObject({ status: "denied", message: "User denied" });
  });
});

describe("the port list", () => {
  it("offers what is attached", async () => {
    const devices = fakeMidiPorts([
      { id: "a", name: "Deluge", manufacturer: "Synthstrom" },
      { id: "b", name: "", manufacturer: "Roland" },
    ]);
    const midi = harness(devices.ports);
    await settle();

    expect(midi().status).toBe("ready");
    expect(midi().outputs.map((output) => output.id)).toEqual(["a", "b"]);
  });

  it("picks up a device plugged in after load", async () => {
    const devices = fakeMidiPorts([{ id: "a", name: "A", manufacturer: "" }]);
    const midi = harness(devices.ports);
    await settle();

    devices.setPorts([
      { id: "a", name: "A", manufacturer: "" },
      { id: "b", name: "B", manufacturer: "" },
    ]);
    await settle();

    expect(midi().outputs.map((output) => output.id)).toEqual(["a", "b"]);
  });
});

describe("the writer", () => {
  it("appears when a port is chosen, and is that port's", async () => {
    const devices = fakeMidiPorts();
    const midi = harness(devices.ports);
    await settle();
    expect(midi().send).toBeUndefined();

    midi.cast({ type: "select", id: devices.firstId });
    await settle();

    expect(midi().send).toBe(devices.out());
  });

  it("silences the device being left behind", async () => {
    const devices = fakeMidiPorts([
      { id: "a", name: "A", manufacturer: "" },
      { id: "b", name: "B", manufacturer: "" },
    ]);
    const midi = harness(devices.ports);
    await settle();

    midi.cast({ type: "select", id: "a" });
    await settle();
    midi.cast({ type: "select", id: "b" });
    await settle();

    expect(devices.out("a")?.panic).toHaveBeenCalledTimes(1);
    expect(midi().selectedId).toBe("b");
    expect(midi().send).toBe(devices.out("b"));
  });

  it("drops the selection when the chosen device is unplugged", async () => {
    const devices = fakeMidiPorts();
    const midi = harness(devices.ports);
    await settle();

    midi.cast({ type: "select", id: devices.firstId });
    await settle();
    const writer = devices.out();

    devices.setPorts([]);
    await settle();

    expect(midi().selectedId).toBe("");
    expect(midi().send).toBeUndefined();
    // The cable is out, but a virtual port would still be listening.
    expect(writer?.panic).toHaveBeenCalledTimes(1);
  });

  it("silences and unhooks on disposal", async () => {
    const devices = fakeMidiPorts();
    const midi = spawn(midiProc(devices.ports), undefined, { initial });
    await settle();
    midi.cast({ type: "select", id: devices.firstId });
    await settle();

    await midi[Symbol.asyncDispose]();

    expect(devices.out()?.panic).toHaveBeenCalledTimes(1);
    expect(devices.listenerCount).toBe(0);
  });
});
