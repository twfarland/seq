import type { Process } from "@nonchalant/core";
import type { Clip, Lane } from "~/domain/pattern";
import type { Playhead } from "~/app/playhead";
import type { SequencerMsg, SequencerState } from "~/app/messages";

/**
 * What every editor component needs, threaded down instead of re-derived.
 *
 * Components take processes, not values. A component is called once, and the
 * bindings inside it are what stay live, so passing a snapshot down would
 * freeze it. Passing indices rather than the clip or lane itself is deliberate
 * for the same reason: each binding re-reads its own path, which is what keeps
 * a step toggle from touching anything but that step.
 */
export interface Editor {
  seq: Process<SequencerState | undefined, SequencerMsg>;
  playhead: Process<Playhead>;
  /** Play a lane's note while its Audition button is held. */
  audition: (clipIndex: number, laneIndex: number, on: boolean) => void;
}

export const clipAt =
  (editor: Editor, clipIndex: number) =>
  (): Clip | undefined =>
    editor.seq()?.pattern.clips[clipIndex];

export const laneAt =
  (editor: Editor, clipIndex: number, laneIndex: number) =>
  (): Lane | undefined =>
    editor.seq()?.pattern.clips[clipIndex]?.lanes[laneIndex];
