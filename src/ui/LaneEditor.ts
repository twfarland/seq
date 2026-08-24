import type { VNode } from "@nonchalant/core";
import { button, div, span } from "@nonchalant/dom/tags";
import { stepsPerLoop } from "~/domain/pattern";
import { clipAt, laneAt, type Editor } from "./context";
import { NumberField, TextField } from "./Fields";

/**
 * One monophonic row: its instrument label, its note, and its step grid.
 *
 * The grid is a keyed thunk over the step *count* only. Reading the length and
 * nothing else is what keeps an edit local: toggling a step changes no length,
 * so this thunk sleeps and only the one button that reads that step wakes up.
 */

function StepButton(
  editor: Editor,
  clipIndex: number,
  laneIndex: number,
  stepIndex: number,
  subdivisionPerBeat: () => number
): VNode {
  const lane = laneAt(editor, clipIndex, laneIndex);
  const step = () => lane()?.steps[stepIndex];

  const isBeatStart = () =>
    stepIndex % Math.max(1, subdivisionPerBeat()) === 0;
  const isPlaying = () =>
    editor.seq()?.running === true &&
    editor.playhead()[clipIndex] === stepIndex;

  return button(
    {
      key: stepIndex,
      type: "button",
      class: () =>
        [
          "step",
          step() !== undefined ? "step--on" : "",
          isBeatStart() ? "step--beat" : "",
          isPlaying() ? "step--playing" : "",
        ]
          .filter(Boolean)
          .join(" "),
      "aria-pressed": () => step() !== undefined,
      "aria-label": `Step ${stepIndex + 1}`,
      onclick: () =>
        editor.seq.cast({
          type: "toggle_step",
          clipIndex,
          laneIndex,
          stepIndex,
        }),
    },
    () => {
      const current = step();
      return current
        ? span({ class: "step__velocity" }, String(current.velocity))
        : null;
    }
  );
}

export function LaneEditor(
  editor: Editor,
  clipIndex: number,
  laneIndex: number
): VNode {
  const clip = clipAt(editor, clipIndex);
  const lane = laneAt(editor, clipIndex, laneIndex);
  const instrument = () => lane()?.instrument ?? "";
  const subdivisionPerBeat = () => clip()?.subdivisionPerBeat ?? 1;
  const stepCount = () => {
    const current = clip();
    return current === undefined ? 0 : stepsPerLoop(current);
  };

  const update = (patch: { instrument?: string; midiNote?: number }) =>
    editor.seq.cast({ type: "update_lane", clipIndex, laneIndex, patch });

  return div(
    { key: laneIndex, class: "lane" },
    div(
      { class: "lane__controls" },
      TextField({
        label: "Instrument",
        value: instrument,
        onChange: (value) => update({ instrument: value }),
      }),
      NumberField({
        label: "Note",
        value: () => lane()?.midiNote ?? 0,
        min: 0,
        max: 127,
        title: "MIDI note number (36 = GM kick, 60 = middle C)",
        onChange: (midiNote) => update({ midiNote }),
      }),
      button(
        {
          type: "button",
          class: "button button--audition",
          // Pointer capture keeps the release on this element even if the
          // pointer drifts off it mid-press. Without it, dragging away skips
          // pointerup entirely and the auditioned note sounds forever.
          //
          // It is best-effort: capture throws on a pointer id that is no longer
          // active, and a note that never sounds is worse than one that might
          // need a Panic.
          onpointerdown: (event: PointerEvent) => {
            try {
              (event.currentTarget as Element).setPointerCapture?.(
                event.pointerId
              );
            } catch {
              /* capture unavailable; the plain pointerup path still works */
            }
            editor.audition(clipIndex, laneIndex, true);
          },
          onpointerup: () => editor.audition(clipIndex, laneIndex, false),
          onpointercancel: () => editor.audition(clipIndex, laneIndex, false),
        },
        "Audition"
      ),
      button(
        {
          type: "button",
          class: "button button--ghost",
          "aria-label": () => `Remove lane ${instrument()}`,
          onclick: () =>
            editor.seq.cast({ type: "remove_lane", clipIndex, laneIndex }),
        },
        "✕"
      )
    ),

    div(
      {
        class: "lane__steps",
        role: "group",
        "aria-label": () => `${instrument()} steps`,
      },
      () =>
        Array.from({ length: stepCount() }, (_, stepIndex) =>
          StepButton(editor, clipIndex, laneIndex, stepIndex, subdivisionPerBeat)
        )
    )
  );
}
