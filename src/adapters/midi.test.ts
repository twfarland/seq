import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeMidiAccess, fakeMidiOutput } from "~/test/fakes";
import { midiDirectory, MidiSend } from "./midi";

function fakeOutput() {
  const send = vi.fn<(data: number[], time?: number) => void>();
  // Only `send` is exercised; the cast keeps the test free of the rest of the
  // MIDIOutput surface (open/close/EventTarget), none of which this class uses.
  return { send, port: { send } as unknown as MIDIOutput };
}

let output: ReturnType<typeof fakeOutput>;
let midi: MidiSend;

beforeEach(() => {
  output = fakeOutput();
  midi = new MidiSend(output.port);
});

const sent = () => output.send.mock.calls.map(([data]) => data);

describe("real-time messages", () => {
  it("sends the spec-defined status bytes", () => {
    midi.clock();
    midi.start();
    midi.continue_();
    midi.stop();
    expect(sent()).toEqual([[0xf8], [0xfa], [0xfb], [0xfc]]);
  });

  it("passes the timestamp through to the port", () => {
    midi.clock(1234.5);
    expect(output.send).toHaveBeenCalledWith([0xf8], 1234.5);
  });
});

describe("channel voice messages", () => {
  it("packs a 1-based channel into the status nibble", () => {
    midi.noteOn({ channel: 1, midiNote: 60, velocity: 100 });
    midi.noteOn({ channel: 10, midiNote: 36, velocity: 127 });
    midi.noteOn({ channel: 16, midiNote: 60, velocity: 1 });
    expect(sent()).toEqual([
      [0x90, 60, 100],
      [0x99, 36, 127],
      [0x9f, 60, 1],
    ]);
  });

  it("sends note off with release velocity zero", () => {
    midi.noteOff({ channel: 10, midiNote: 36 });
    expect(sent()).toEqual([[0x89, 36, 0]]);
  });

  it("clamps a channel outside 1..16 rather than corrupting the status byte", () => {
    // channel - 1 unclamped would carry into the status nibble and turn a
    // note-on into some other message entirely.
    midi.noteOn({ channel: 0, midiNote: 60, velocity: 100 });
    midi.noteOn({ channel: 99, midiNote: 60, velocity: 100 });
    expect(sent()).toEqual([
      [0x90, 60, 100],
      [0x9f, 60, 100],
    ]);
  });

  it("clamps data bytes into 0..127", () => {
    midi.noteOn({ channel: 1, midiNote: 999, velocity: -5 });
    expect(sent()).toEqual([[0x90, 127, 0]]);
  });

  it("survives non-finite input without throwing", () => {
    midi.noteOn({
      channel: Number.NaN,
      midiNote: Number.POSITIVE_INFINITY,
      velocity: Number.NaN,
    });
    const [data] = sent();
    expect(data!.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 0xff)).toBe(true);
  });
});

describe("panic", () => {
  it("sends all-notes-off and all-sound-off on every channel", () => {
    midi.panic();
    expect(output.send).toHaveBeenCalledTimes(32);
    expect(sent()[0]).toEqual([0xb0, 123, 0]);
    expect(sent()[1]).toEqual([0xb0, 120, 0]);
    expect(sent().at(-2)).toEqual([0xbf, 123, 0]);
    expect(sent().at(-1)).toEqual([0xbf, 120, 0]);
  });

  it("silences a single channel on request", () => {
    midi.allNotesOff(10);
    expect(sent()).toEqual([
      [0xb9, 123, 0],
      [0xb9, 120, 0],
    ]);
  });
});

describe("the directory", () => {
  it("describes each attached port, defaulting the fields drivers omit", () => {
    const a = fakeMidiOutput({ id: "a", name: "Deluge" });
    // Some drivers report neither, which is why the port describes itself.
    const b = fakeMidiOutput({ id: "b", name: null, manufacturer: null });
    const directory = midiDirectory(fakeMidiAccess([a.port, b.port]).access);

    expect(directory.list()).toEqual([
      { id: "a", name: "Deluge", manufacturer: "Test" },
      { id: "b", name: "", manufacturer: "" },
    ]);
  });

  it("opens a writer for a port, and nothing for one that has gone", () => {
    const a = fakeMidiOutput({ id: "a" });
    const directory = midiDirectory(fakeMidiAccess([a.port]).access);

    directory.open("a")?.noteOn({ channel: 1, midiNote: 60, velocity: 100 });
    expect(a.send).toHaveBeenCalledWith([0x90, 60, 100], undefined);
    expect(directory.open("nope")).toBeUndefined();
  });

  it("reports hotplug, and unhooks when asked", () => {
    const access = fakeMidiAccess([]);
    const directory = midiDirectory(access.access);

    let changes = 0;
    const stop = directory.onChange(() => changes++);
    access.setOutputs([fakeMidiOutput({ id: "a" }).port]);
    expect(changes).toBe(1);
    expect(directory.list()).toHaveLength(1);

    stop();
    access.setOutputs([]);
    expect(changes).toBe(1);
    expect(access.listenerCount).toBe(0);
  });
});
