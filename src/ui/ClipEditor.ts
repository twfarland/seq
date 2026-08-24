import type { VNode } from "@nonchalant/core";
import { article, button, header, p, span } from "@nonchalant/dom/tags";
import {
  clipTimingError,
  stepsPerLoop,
  MIDI_CLOCK_PPQ,
} from "~/domain/pattern";
import type { ClipPatch } from "~/app/messages";
import { clipAt, type Editor } from "./context";
import { NumberField, TextField } from "./Fields";
import { LaneEditor } from "./LaneEditor";

/**
 * One looping clip: its meter, its channel, and its lanes.
 *
 * Lanes are keyed by index rather than by identity. Identity would need a
 * stable id on every lane, and index keys behave correctly here for the reason
 * that matters: each row reads its data through its *own* index, so removing a
 * lane shrinks the list and every surviving row re-reads and updates in place.
 */
export function ClipEditor(editor: Editor, clipIndex: number): VNode {
  const clip = clipAt(editor, clipIndex);
  const name = () => clip()?.name ?? "";
  const laneCount = () => clip()?.lanes.length ?? 0;
  const stepCount = () => {
    const current = clip();
    return current === undefined ? 0 : stepsPerLoop(current);
  };
  const timingError = () => {
    const current = clip();
    const ppq = editor.seq()?.ppq ?? MIDI_CLOCK_PPQ;
    return current === undefined ? null : clipTimingError(current, ppq);
  };

  const update = (patch: ClipPatch) =>
    editor.seq.cast({ type: "update_clip", clipIndex, patch });

  return article(
    { key: clipIndex, class: "clip" },
    header(
      { class: "clip__header" },
      TextField({
        label: "Clip",
        value: name,
        onChange: (value) => update({ name: value }),
      }),
      NumberField({
        label: "Channel",
        value: () => clip()?.channel ?? 1,
        min: 1,
        max: 16,
        title: "1-based MIDI channel. 10 is the General MIDI drum channel.",
        onChange: (channel) => update({ channel }),
      }),
      NumberField({
        label: "Beats",
        value: () => clip()?.beatsPerMeasure ?? 1,
        min: 1,
        max: 32,
        title: "Beats per loop",
        onChange: (beatsPerMeasure) => update({ beatsPerMeasure }),
      }),
      NumberField({
        label: "Subdivision",
        value: () => clip()?.subdivisionPerBeat ?? 1,
        min: 1,
        max: 32,
        title: "Steps per beat. Must divide PPQ evenly.",
        onChange: (subdivisionPerBeat) => update({ subdivisionPerBeat }),
      }),
      span({ class: "clip__meta" }, () => `${stepCount()} steps`),
      button(
        {
          type: "button",
          class: "button button--ghost",
          "aria-label": () => `Remove clip ${name()}`,
          onclick: () => editor.seq.cast({ type: "remove_clip", clipIndex }),
        },
        "✕"
      )
    ),

    // Clips loop independently, so an unplayable subdivision silences just
    // this clip rather than the whole pattern - worth saying out loud.
    () => {
      const message = timingError();
      return message ? p({ class: "notice notice--warn" }, message) : null;
    },

    () =>
      Array.from({ length: laneCount() }, (_, laneIndex) =>
        LaneEditor(editor, clipIndex, laneIndex)
      ),

    button(
      {
        type: "button",
        class: "button",
        onclick: () => editor.seq.cast({ type: "add_lane", clipIndex }),
      },
      "+ Lane"
    )
  );
}
