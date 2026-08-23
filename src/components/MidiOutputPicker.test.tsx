import { render, screen, waitFor, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeMidiOutput } from "~/test/fakes";
import { MidiOutputPicker } from "./MidiOutputPicker";

/** Minimal MIDIAccess whose port list and statechange events the test drives. */
function fakeAccess(initial: MIDIOutput[]) {
  const outputs = new Map(initial.map((port) => [port.id, port]));
  const listeners: (() => void)[] = [];
  return {
    access: {
      outputs,
      addEventListener: (_type: string, listener: () => void) =>
        listeners.push(listener),
    } as unknown as MIDIAccess,
    /** Replace the port list and fire `statechange`, as a hotplug would. */
    setPorts(ports: MIDIOutput[]) {
      outputs.clear();
      for (const port of ports) outputs.set(port.id, port);
      for (const listener of listeners) listener();
    },
  };
}

function stubMidi(result: Promise<MIDIAccess>) {
  Object.defineProperty(navigator, "requestMIDIAccess", {
    value: vi.fn(() => result),
    configurable: true,
    writable: true,
  });
}

function removeMidi() {
  Reflect.deleteProperty(navigator as object, "requestMIDIAccess");
}

afterEach(() => removeMidi());

const child = (output: MIDIOutput) => <p>connected to {output.name}</p>;

describe("unsupported browsers", () => {
  it("explains that Web MIDI is unavailable", async () => {
    removeMidi();
    render(() => <MidiOutputPicker>{child}</MidiOutputPicker>);
    expect(
      await screen.findByText(/does not support the Web MIDI API/i)
    ).toBeInTheDocument();
  });
});

describe("permission", () => {
  it("surfaces the rejection reason instead of failing silently", async () => {
    stubMidi(Promise.reject(new Error("Permission denied")));
    render(() => <MidiOutputPicker>{child}</MidiOutputPicker>);
    expect(await screen.findByText(/Permission denied/)).toBeInTheDocument();
  });
});

describe("port selection", () => {
  it("lists the available outputs by id", async () => {
    const a = fakeMidiOutput({ id: "a", name: "Deluge" }).port;
    const b = fakeMidiOutput({ id: "b", name: "TR-8S" }).port;
    stubMidi(Promise.resolve(fakeAccess([a, b]).access));

    render(() => <MidiOutputPicker>{child}</MidiOutputPicker>);

    const select = await screen.findByRole("combobox");
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
      "",
      "a",
      "b",
    ]);
  });

  it("renders children only once an output is chosen", async () => {
    const a = fakeMidiOutput({ id: "a", name: "Deluge" }).port;
    stubMidi(Promise.resolve(fakeAccess([a]).access));

    render(() => <MidiOutputPicker>{child}</MidiOutputPicker>);

    const select = await screen.findByRole("combobox");
    expect(screen.queryByText(/connected to/)).not.toBeInTheDocument();

    await userEvent.selectOptions(select, "a");
    expect(await screen.findByText("connected to Deluge")).toBeInTheDocument();
  });

  it("tells the user when no outputs exist", async () => {
    stubMidi(Promise.resolve(fakeAccess([]).access));
    render(() => <MidiOutputPicker>{child}</MidiOutputPicker>);
    expect(await screen.findByText(/No MIDI outputs found/i)).toBeInTheDocument();
  });

  it("drops the selection when the chosen device is unplugged", async () => {
    const a = fakeMidiOutput({ id: "a", name: "Deluge" }).port;
    const hardware = fakeAccess([a]);
    stubMidi(Promise.resolve(hardware.access));

    render(() => <MidiOutputPicker>{child}</MidiOutputPicker>);
    await userEvent.selectOptions(await screen.findByRole("combobox"), "a");
    expect(await screen.findByText("connected to Deluge")).toBeInTheDocument();

    // Pulling the cable must tear the sequencer down rather than leave it
    // writing to a dead port.
    hardware.setPorts([]);
    await waitFor(() =>
      expect(screen.queryByText(/connected to/)).not.toBeInTheDocument()
    );
  });

  it("picks up a device plugged in after load", async () => {
    const hardware = fakeAccess([]);
    stubMidi(Promise.resolve(hardware.access));

    render(() => <MidiOutputPicker>{child}</MidiOutputPicker>);
    expect(await screen.findByText(/No MIDI outputs found/i)).toBeInTheDocument();

    hardware.setPorts([fakeMidiOutput({ id: "c", name: "Digitakt" }).port]);
    expect(await screen.findByRole("combobox")).toBeInTheDocument();
  });
});
