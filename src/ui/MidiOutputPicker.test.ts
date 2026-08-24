import { spawn } from "@nonchalant/core";
import type { Process } from "@nonchalant/core";
import { afterEach, describe, expect, it } from "vitest";
import { midiProc, type MidiMsg, type MidiState } from "~/app/outputs";
import type { MidiPorts } from "~/app/ports";
import { fakeMidiPorts, noMidiPorts, refusedMidiPorts } from "~/test/fakes";
import { render, settle } from "~/test/render";
import { MidiOutputPicker } from "./MidiOutputPicker";

const initial: MidiState = {
  status: "idle",
  message: "",
  outputs: [],
  inputs: [],
  selectedId: "",
  send: undefined,
};

const disposers: (() => void)[] = [];

function picker(ports: MidiPorts) {
  const midi: Process<MidiState, MidiMsg> = spawn(midiProc(ports), undefined, {
    initial,
  });
  const view = render(MidiOutputPicker(midi));
  disposers.push(() => {
    view[Symbol.dispose]();
    midi[Symbol.dispose]();
  });
  return { midi, container: view.container };
}

const options = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("option"));

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe("unsupported browsers", () => {
  it("explains that Web MIDI is unavailable", async () => {
    const { container } = picker(noMidiPorts);
    await settle();
    expect(container.textContent).toContain(
      "does not support the Web MIDI API"
    );
  });
});

describe("permission", () => {
  it("offers a button rather than prompting on load", async () => {
    const { container } = picker(refusedMidiPorts("Dismissed"));
    await settle();

    const enable = container.querySelector("button") as HTMLButtonElement;
    expect(enable.textContent).toBe("Enable MIDI");
    expect(container.textContent).toContain("needs permission");
  });

  it("surfaces the rejection reason after the button is pressed", async () => {
    const { container } = picker(refusedMidiPorts("Dismissed"));
    await settle();

    (container.querySelector("button") as HTMLButtonElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    await settle();

    expect(container.textContent).toContain("Dismissed");
    // A refusal is recoverable: site settings can be changed and the ask retried.
    expect(container.querySelector("button")?.textContent).toBe("Try again");
  });

  it("says what it is doing while the browser decides", async () => {
    // A promise that never settles: the prompt is up, or was suppressed.
    const { container } = picker({
      available: () => true,
      permission: () => Promise.resolve("prompt"),
      open: () => new Promise(() => {}),
    });
    await settle();

    (container.querySelector("button") as HTMLButtonElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    await settle();

    // Never blank: a blank panel is indistinguishable from a broken app.
    expect(container.textContent).toContain("Waiting for permission");
  });
});

describe("port selection", () => {
  it("lists the available outputs by id", async () => {
    const devices = fakeMidiPorts([
      { id: "a", name: "Deluge", manufacturer: "Synthstrom" },
    ]);
    const { container } = picker(devices.ports);
    await settle();

    expect(options(container).map((option) => option.value)).toEqual(["", "a"]);
    expect(options(container)[1]?.textContent).toBe("Deluge — Synthstrom");
  });

  it("tells the user when no outputs exist, and offers another look", async () => {
    const devices = fakeMidiPorts([]);
    const { container } = picker(devices.ports);
    await settle();
    expect(container.textContent).toContain("No MIDI outputs found");

    devices.attachQuietly([{ id: "a", name: "A", manufacturer: "" }]);
    (container.querySelector("button") as HTMLButtonElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    await settle();

    expect(container.querySelector("select")).not.toBeNull();
  });

  it("names the device it can only see an input for", async () => {
    // The common Windows case: the hardware is there, but its output port is
    // already open in another application.
    const devices = fakeMidiPorts(
      [],
      "granted",
      [{ id: "in-1", name: "AudioBox USB 96", manufacturer: "PreSonus" }]
    );
    const { container } = picker(devices.ports);
    await settle();

    expect(container.textContent).toContain("AudioBox USB 96");
    expect(container.textContent).toContain("only be open in one application");
  });

  it("says nothing about inputs when there are none to report", async () => {
    const { container } = picker(fakeMidiPorts([]).ports);
    await settle();
    expect(container.textContent).not.toContain("MIDI input");
  });

  it("chooses a port, and marks it selected without a value binding", async () => {
    const devices = fakeMidiPorts([
      { id: "a", name: "A", manufacturer: "" },
      { id: "b", name: "B", manufacturer: "" },
    ]);
    const { midi, container } = picker(devices.ports);
    await settle();

    const select = container.querySelector("select") as HTMLSelectElement;
    select.value = "b";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();

    expect(midi().selectedId).toBe("b");
    // The `<select>` carries no `value` binding - attributes are applied before
    // children exist, so it would have had nothing to match. Each option owns
    // its own `selected` instead.
    expect(options(container).map((option) => option.selected)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("picks up a device plugged in after load", async () => {
    const devices = fakeMidiPorts([{ id: "a", name: "A", manufacturer: "" }]);
    const { container } = picker(devices.ports);
    await settle();

    devices.setPorts([
      { id: "a", name: "A", manufacturer: "" },
      { id: "b", name: "B", manufacturer: "" },
    ]);
    await settle();

    expect(options(container).map((option) => option.value)).toEqual([
      "",
      "a",
      "b",
    ]);
  });

  it("drops the selection when the chosen device is unplugged", async () => {
    const devices = fakeMidiPorts([{ id: "a", name: "A", manufacturer: "" }]);
    const { midi, container } = picker(devices.ports);
    await settle();

    midi.cast({ type: "select", id: "a" });
    await settle();
    expect(midi().send).toBeDefined();

    devices.setPorts([]);
    await settle();

    expect(midi().send).toBeUndefined();
    expect(container.textContent).toContain("No MIDI outputs found");
  });
});
