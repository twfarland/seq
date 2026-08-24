import { spawn } from "@nonchalant/core";
import type { Process } from "@nonchalant/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession, type Session } from "~/app/session";
import { midiProc, type MidiMsg, type MidiState } from "~/app/outputs";
import {
  fakeMidiPorts,
  manualFrames,
  memoryChannel,
  type FakeMidiOut,
} from "~/test/fakes";
import { render, settle, watchWrites, type Rendered } from "~/test/render";
import { SequencerControl } from "./SequencerControl";

/**
 * The editor, asserted through what reaches the sequencer and the MIDI port.
 *
 * The pattern lives in the worker now, so nothing here is a local edit: a click
 * is a cast, and what appears on screen is whatever came back. That makes these
 * round-trip tests rather than render tests, which is the honest shape - the
 * bug they guard against is an edit that never arrives.
 */

const initialMidi: MidiState = {
  status: "idle",
  message: "",
  outputs: [],
  selectedId: "",
  send: undefined,
};

let channel: ReturnType<typeof memoryChannel>;
let devices: ReturnType<typeof fakeMidiPorts>;
let out: FakeMidiOut;
let midi: Process<MidiState, MidiMsg>;
let session: Session;
let view: Rendered;

/** A cast has to reach the host, be handled, yield, and come back as a patch. */
const sync = async () => {
  for (let round = 0; round < 4; round++) {
    await channel.settle();
    await settle();
  }
};

const $ = <T extends Element>(selector: string): T =>
  view.container.querySelector<T>(selector) as T;
const $$ = <T extends Element>(selector: string): T[] =>
  Array.from(view.container.querySelectorAll<T>(selector));

const byText = (selector: string, text: string): HTMLButtonElement =>
  $$<HTMLButtonElement>(selector).find(
    (element) => element.textContent?.trim() === text
  ) as HTMLButtonElement;

const click = async (element: Element) => {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await sync();
};

const typeInto = async (element: HTMLInputElement, value: string) => {
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  await sync();
};

/** The step buttons of one lane. */
const steps = (laneIndex = 0) =>
  Array.from(
    $$<HTMLElement>(".lane")[laneIndex]?.querySelectorAll<HTMLButtonElement>(
      ".step"
    ) ?? []
  );

beforeEach(async () => {
  channel = memoryChannel();
  devices = fakeMidiPorts();
  midi = spawn(midiProc(devices.ports), undefined, { initial: initialMidi });
  // Permission resolves through the mailbox, so the port list has to exist
  // before anything can be chosen from it.
  await settle();

  session = createSession({
    channel: channel.channel,
    output: () => midi().send,
    frames: manualFrames().arm,
    documentOrigin: 0,
  });

  midi.cast({ type: "select", id: devices.firstId });
  await sync();
  out = devices.out() as FakeMidiOut;

  view = render(SequencerControl(session, midi));
  await settle();
});

afterEach(() => {
  view[Symbol.dispose]();
  session[Symbol.dispose]();
  midi[Symbol.dispose]();
});

describe("initial state", () => {
  it("shows the pattern the worker opened with", () => {
    expect($<HTMLInputElement>(".field__input").value).toBe("120");
    expect($$(".clip")).toHaveLength(1);
    expect($$(".lane")).toHaveLength(3);
    expect(steps()).toHaveLength(16);
  });
});

describe("transport", () => {
  it("starts and stops, following the worker's own state", async () => {
    const start = byText("button", "Start");
    const stop = byText("button", "Stop");
    expect(stop.hasAttribute("disabled")).toBe(true);

    await click(start);
    expect(start.hasAttribute("disabled")).toBe(true);
    expect(stop.hasAttribute("disabled")).toBe(false);

    await click(stop);
    expect(start.hasAttribute("disabled")).toBe(false);
  });

  it("panics on both the sequencer and the output directly", async () => {
    out.panic.mockClear();
    await click(byText("button", "Panic"));
    // Auditioned notes are unknown to the engine, so the output is silenced
    // here as well.
    expect(out.panic).toHaveBeenCalledTimes(1);
  });

  it("forwards a tempo change", async () => {
    const bpm = $$<HTMLInputElement>(".field__input")[0] as HTMLInputElement;
    await typeInto(bpm, "140");
    expect(session.sequencer()?.bpm).toBe(140);
  });

  it("warns when PPQ leaves the MIDI standard", async () => {
    const ppq = $$<HTMLInputElement>(".field__input")[1] as HTMLInputElement;
    expect(view.container.textContent).not.toContain("non-standard");

    await typeInto(ppq, "25");
    expect(view.container.textContent).toContain("non-standard");
  });
});

describe("step editing", () => {
  it("turns a step on and off again", async () => {
    const [, second] = steps();
    expect(second?.getAttribute("aria-pressed")).toBe("false");

    await click(second as Element);
    expect(second?.getAttribute("aria-pressed")).toBe("true");
    expect(second?.textContent).toBe("100");

    await click(second as Element);
    expect(second?.getAttribute("aria-pressed")).toBe("false");
  });

  it("does not disturb the other lanes", async () => {
    const before = steps(1).map((step) => step.getAttribute("aria-pressed"));
    await click(steps(0)[5] as Element);
    expect(steps(1).map((step) => step.getAttribute("aria-pressed"))).toEqual(
      before
    );
  });
});

describe("clip and lane editing", () => {
  it("retunes a lane without losing its steps", async () => {
    const note = $$<HTMLInputElement>(".lane .field__input")[1] as HTMLInputElement;
    const before = steps().filter(
      (step) => step.getAttribute("aria-pressed") === "true"
    ).length;

    await typeInto(note, "41");

    expect(session.sequencer()?.pattern.clips[0]?.lanes[0]?.midiNote).toBe(41);
    expect(
      steps().filter((step) => step.getAttribute("aria-pressed") === "true")
    ).toHaveLength(before);
  });

  it("resizes the step grid when the time signature changes", async () => {
    const beats = $$<HTMLInputElement>(".clip__header .field__input")[2] as HTMLInputElement;
    await typeInto(beats, "3");
    expect(steps()).toHaveLength(12);
    expect(view.container.textContent).toContain("12 steps");
  });

  it("keeps notes beyond the new bar length so shrinking is not destructive", async () => {
    const beats = $$<HTMLInputElement>(".clip__header .field__input")[2] as HTMLInputElement;
    await typeInto(beats, "2");
    expect(steps()).toHaveLength(8);

    await typeInto(beats, "4");
    // The kick on step 12 is back: `Lane.steps` is a sparse map, so a shorter
    // bar hides notes rather than destroying them.
    expect(steps()[12]?.getAttribute("aria-pressed")).toBe("true");
  });

  it("warns when a clip's subdivision cannot be represented at this PPQ", async () => {
    const subdivision = $$<HTMLInputElement>(".clip__header .field__input")[3] as HTMLInputElement;
    await typeInto(subdivision, "5");
    expect(view.container.textContent).toContain("not divisible by 5");
  });

  it("adds and removes clips", async () => {
    await click(byText("button", "+ Clip"));
    expect($$(".clip")).toHaveLength(2);

    await click($$(".clip")[1]?.querySelector(".button--ghost") as Element);
    expect($$(".clip")).toHaveLength(1);
  });

  it("adds and removes lanes", async () => {
    await click(byText("button", "+ Lane"));
    expect($$(".lane")).toHaveLength(4);

    await click($$(".lane")[0]?.querySelector(".button--ghost") as Element);
    expect($$(".lane")).toHaveLength(3);
    // The first lane is gone, so what was second is now first.
    expect(session.sequencer()?.pattern.clips[0]?.lanes[0]?.instrument).toBe(
      "snare"
    );
  });
});

describe("auditioning", () => {
  it("sends note on then note off around a press", async () => {
    const audition = $(".button--audition");

    audition.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    audition.dispatchEvent(new Event("pointerup", { bubbles: true }));

    // The bytes are the adapter's business (`adapters/midi.test.ts`); what the
    // view owes is the right note on the right channel, bracketing the press.
    expect(out.noteOn).toHaveBeenCalledWith({
      channel: 10,
      midiNote: 36,
      velocity: 100,
    });
    expect(out.noteOff).toHaveBeenCalledWith({ channel: 10, midiNote: 36 });
  });
});

describe("granularity", () => {
  it("touches one step button and nothing else in the grid", async () => {
    const target = steps()[7] as HTMLButtonElement;
    const writes = watchWrites(view.container);

    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await sync();
    const touched = await writes.take();
    writes.stop();

    expect(touched.length).toBeGreaterThan(0);
    // The pattern is 48 step buttons, three lanes and a clip header. A patch
    // naming one step path wakes the bindings that read that path, and nothing
    // reads it but this button.
    expect(new Set(touched)).toEqual(new Set([target]));
  });

  it("touches no step at all when a lane is renamed", async () => {
    const instrument = $$<HTMLInputElement>(".lane .field__input")[0] as HTMLInputElement;
    const writes = watchWrites(view.container);

    await typeInto(instrument, "boom");
    const touched = await writes.take();
    writes.stop();

    expect(touched.some((element) => element.classList.contains("step"))).toBe(
      false
    );
  });
});
