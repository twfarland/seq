import { render, screen, waitFor, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pattern } from "~/sequencer/pattern";
import type { SequencerCommand, SequencerEvent } from "~/sequencer/protocol";
import { FakeWorker, fakeMidiOutput } from "~/test/fakes";
import { SequencerControl } from "./SequencerControl";

/**
 * End-to-end through the UI: every assertion is about what actually reaches the
 * worker or the MIDI port, which is the only behaviour that makes a sound.
 */

let midi: ReturnType<typeof fakeMidiOutput>;
let originalWorker: typeof Worker | undefined;

beforeEach(() => {
  FakeWorker.reset();
  midi = fakeMidiOutput();
  originalWorker = globalThis.Worker;
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
});

afterEach(() => {
  if (originalWorker) globalThis.Worker = originalWorker;
});

const commands = () => FakeWorker.last.posted as SequencerCommand[];

const lastPattern = (): Pattern => {
  const patterns = commands().filter((c) => c.type === "set_pattern");
  const last = patterns.at(-1);
  if (!last) throw new Error("no pattern was sent to the worker");
  return last.pattern;
};

const laneOf = (instrument: string) =>
  lastPattern().clips[0]!.lanes.find((l) => l.instrument === instrument)!;

function mount() {
  return render(() => <SequencerControl midiOutput={midi.port} />);
}

describe("initial sync", () => {
  it("pushes tempo, resolution and pattern to the worker on mount", () => {
    mount();
    const types = commands().map((c) => c.type);
    expect(types).toContain("set_bpm");
    expect(types).toContain("set_ppq");
    expect(types).toContain("set_pattern");
    expect(lastPattern().name).toBe("Four on the Floor");
  });

  it("sends a plain object, not a store proxy, across the worker boundary", () => {
    mount();
    // structuredClone is what postMessage does; a proxy that cannot survive it
    // would throw here rather than in the browser.
    expect(() => structuredClone(lastPattern())).not.toThrow();
  });
});

describe("transport", () => {
  it("starts and stops, following the worker's own state", async () => {
    mount();
    const start = screen.getByRole("button", { name: "Start" });
    const stop = screen.getByRole("button", { name: "Stop" });
    expect(stop).toBeDisabled();

    await userEvent.click(start);
    expect(commands().at(-1)).toEqual({ type: "start" });

    // The button state follows the worker's acknowledgement, not the click,
    // so a worker that never starts cannot leave the UI lying.
    FakeWorker.last.emit({ type: "started", time: 0 } satisfies SequencerEvent);
    await waitFor(() => expect(start).toBeDisabled());
    expect(stop).toBeEnabled();

    await userEvent.click(stop);
    expect(commands().at(-1)).toEqual({ type: "stop" });
  });

  it("panics on both the worker and the port directly", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Panic" }));

    expect(commands().at(-1)).toEqual({ type: "panic" });
    // 16 channels x (all-notes-off + all-sound-off): the UI thread sends its
    // own panic too, because auditioned notes are not tracked by the engine.
    expect(midi.send).toHaveBeenCalledTimes(32);
  });

  it("forwards a tempo change", async () => {
    mount();
    const bpm = screen.getByLabelText("BPM");
    await userEvent.clear(bpm);
    await userEvent.type(bpm, "140");
    expect(commands().filter((c) => c.type === "set_bpm").at(-1)).toEqual({
      type: "set_bpm",
      bpm: 140,
    });
  });

  it("warns when PPQ leaves the MIDI standard", async () => {
    mount();
    expect(screen.queryByText("non-standard")).not.toBeInTheDocument();

    const ppq = screen.getByLabelText("PPQ");
    await userEvent.clear(ppq);
    await userEvent.type(ppq, "48");
    expect(await screen.findByText("non-standard")).toBeInTheDocument();
  });
});

describe("step editing", () => {
  it("turns a step on and off again", async () => {
    mount();
    // The snare starts on steps 4 and 12; step 1 is empty.
    const snareSteps = screen.getByRole("group", { name: "snare steps" });
    const step2 = within(snareSteps).getByRole("button", { name: "Step 2" });

    expect(step2).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(step2);
    expect(Object.keys(laneOf("snare").steps).map(Number)).toEqual([1, 4, 12]);
    expect(step2).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(step2);
    expect(Object.keys(laneOf("snare").steps).map(Number)).toEqual([4, 12]);
  });

  it("does not disturb the other lanes", async () => {
    mount();
    const before = JSON.stringify(laneOf("kick").steps);
    const snareSteps = screen.getByRole("group", { name: "snare steps" });
    await userEvent.click(
      within(snareSteps).getByRole("button", { name: "Step 3" })
    );
    expect(JSON.stringify(laneOf("kick").steps)).toBe(before);
  });
});

describe("clip and lane editing", () => {
  it("retunes a lane without losing its steps", async () => {
    mount();
    const before = Object.keys(laneOf("kick").steps);

    const note = screen.getAllByLabelText("Note")[0]!;
    await userEvent.clear(note);
    await userEvent.type(note, "35");

    expect(lastPattern().clips[0]!.lanes[0]!.midiNote).toBe(35);
    expect(Object.keys(lastPattern().clips[0]!.lanes[0]!.steps)).toEqual(before);
  });

  it("resizes the step grid when the time signature changes", async () => {
    mount();
    const kickSteps = screen.getByRole("group", { name: "kick steps" });
    expect(within(kickSteps).getAllByRole("button")).toHaveLength(16);

    const beats = screen.getByLabelText("Beats");
    await userEvent.clear(beats);
    await userEvent.type(beats, "3");

    await waitFor(() =>
      expect(
        within(screen.getByRole("group", { name: "kick steps" })).getAllByRole(
          "button"
        )
      ).toHaveLength(12)
    );
  });

  it("keeps notes beyond the new bar length so shrinking is not destructive", async () => {
    mount();
    const beats = screen.getByLabelText("Beats");
    await userEvent.clear(beats);
    await userEvent.type(beats, "2"); // 8 steps; the kick has notes at 8 and 12

    await waitFor(() =>
      expect(Object.keys(laneOf("kick").steps).map(Number)).toEqual([
        0, 4, 8, 12,
      ])
    );
  });

  it("warns when a clip's subdivision cannot be represented at this PPQ", async () => {
    mount();
    const subdivision = screen.getByLabelText("Subdivision");
    await userEvent.clear(subdivision);
    await userEvent.type(subdivision, "5");

    expect(await screen.findByText(/not divisible by 5/)).toBeInTheDocument();
  });

  it("adds and removes clips", async () => {
    mount();
    expect(lastPattern().clips).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "+ Clip" }));
    await waitFor(() => expect(lastPattern().clips).toHaveLength(2));

    await userEvent.click(
      screen.getByRole("button", { name: "Remove clip Clip 2" })
    );
    await waitFor(() => expect(lastPattern().clips).toHaveLength(1));
  });

  it("adds and removes lanes", async () => {
    mount();
    expect(lastPattern().clips[0]!.lanes).toHaveLength(3);

    await userEvent.click(screen.getByRole("button", { name: "+ Lane" }));
    await waitFor(() =>
      expect(lastPattern().clips[0]!.lanes).toHaveLength(4)
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Remove lane snare" })
    );
    await waitFor(() =>
      expect(
        lastPattern().clips[0]!.lanes.map((l) => l.instrument)
      ).not.toContain("snare")
    );
  });
});

describe("auditioning", () => {
  it("sends note on then note off around a press", async () => {
    mount();
    const audition = screen.getAllByRole("button", { name: "Audition" })[0]!;

    await userEvent.pointer([
      { target: audition, keys: "[MouseLeft>]" },
      { target: audition, keys: "[/MouseLeft]" },
    ]);

    // Channel 10 (drums), note 36 (kick).
    expect(midi.send.mock.calls.map(([data]) => data)).toEqual([
      [0x99, 36, 100],
      [0x89, 36, 0],
    ]);
  });
});
