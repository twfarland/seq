import { describe, expect, it } from "vitest";
import {
  addClip,
  addLane,
  removeClip,
  removeLane,
  renamePattern,
  toggleStep,
  updateClip,
  updateLane,
} from "./edits";
import type { Pattern } from "./pattern";
import { fourOnTheFloor } from "./presets";

/**
 * The edits are pure, so this suite is input in, output out - but two of its
 * claims are about *identity* rather than value, and those are the ones the
 * rest of the app leans on. Sharing everything that did not change is what
 * makes a patch small; returning the very same object when nothing changed is
 * what makes a no-op cost nothing at all.
 */

const base = (): Pattern => fourOnTheFloor();

describe("what changes", () => {
  it("renames the pattern", () => {
    expect(renamePattern(base(), "Другой").name).toBe("Другой");
  });

  it("appends a clip, numbered after the ones already there", () => {
    const next = addClip(base());
    expect(next.clips).toHaveLength(2);
    expect(next.clips[1]?.name).toBe("Clip 2");
  });

  it("removes a clip", () => {
    expect(removeClip(base(), 0).clips).toHaveLength(0);
  });

  it("patches a clip's own fields, leaving its lanes alone", () => {
    const pattern = base();
    const next = updateClip(pattern, 0, { channel: 5, beatsPerMeasure: 3 });
    expect(next.clips[0]).toMatchObject({ channel: 5, beatsPerMeasure: 3 });
    expect(next.clips[0]?.lanes).toBe(pattern.clips[0]?.lanes);
  });

  it("adds and removes lanes", () => {
    const grown = addLane(base(), 0);
    expect(grown.clips[0]?.lanes).toHaveLength(4);
    expect(removeLane(grown, 0, 0).clips[0]?.lanes).toHaveLength(3);
  });

  it("retunes a lane without touching its steps", () => {
    const pattern = base();
    const next = updateLane(pattern, 0, 0, { midiNote: 41 });
    expect(next.clips[0]?.lanes[0]?.midiNote).toBe(41);
    expect(next.clips[0]?.lanes[0]?.steps).toEqual(
      pattern.clips[0]?.lanes[0]?.steps
    );
  });

  it("toggles a step on, then off - a rest is an absent key", () => {
    const on = toggleStep(base(), 0, 0, 1);
    expect(on.clips[0]?.lanes[0]?.steps[1]).toMatchObject({ velocity: 100 });

    const off = toggleStep(on, 0, 0, 1);
    expect(off.clips[0]?.lanes[0]?.steps).not.toHaveProperty("1");
  });
});

describe("what is shared", () => {
  it("reuses every lane but the one edited", () => {
    const pattern = base();
    const next = toggleStep(pattern, 0, 0, 1);

    expect(next).not.toBe(pattern);
    expect(next.clips[0]).not.toBe(pattern.clips[0]);
    expect(next.clips[0]?.lanes[0]).not.toBe(pattern.clips[0]?.lanes[0]);
    // The untouched lanes are the same objects, which is what keeps the diff
    // proportional to the edit rather than to the pattern.
    expect(next.clips[0]?.lanes[1]).toBe(pattern.clips[0]?.lanes[1]);
    expect(next.clips[0]?.lanes[2]).toBe(pattern.clips[0]?.lanes[2]);
  });

  it("reuses the steps that were already there", () => {
    const pattern = base();
    const next = toggleStep(pattern, 0, 0, 1);
    expect(next.clips[0]?.lanes[0]?.steps[0]).toBe(
      pattern.clips[0]?.lanes[0]?.steps[0]
    );
  });
});

describe("what does not change", () => {
  const pattern = base();

  it.each([
    ["a rename to the same name", () => renamePattern(pattern, pattern.name)],
    ["a clip that is not there", () => updateClip(pattern, 9, { channel: 2 })],
    ["a lane that is not there", () => updateLane(pattern, 0, 9, { midiNote: 1 })],
    ["a step on a missing lane", () => toggleStep(pattern, 0, 9, 0)],
    ["removing a clip that is not there", () => removeClip(pattern, 9)],
    ["removing a lane that is not there", () => removeLane(pattern, 0, 9)],
    ["adding a lane to a missing clip", () => addLane(pattern, 9)],
  ])("returns the very same pattern for %s", (_name, edit) => {
    expect(edit()).toBe(pattern);
  });
});
