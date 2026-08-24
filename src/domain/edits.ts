import type { Clip, Lane, Pattern, Step } from "./pattern";
import { emptyClip, emptyLane, makeStep } from "./presets";

/** Edits to a clip's own fields. Its lanes are edited through their own calls. */
export type ClipPatch = Partial<Omit<Clip, "lanes">>;
/** Edits to a lane's own fields. Its steps are edited through `toggleStep`. */
export type LanePatch = Partial<Omit<Lane, "steps">>;


/**
 * Every edit the sequencer can make to a {@link Pattern}, as pure functions.
 *
 * Two rules hold throughout, and both are load-bearing:
 *
 * 1. **Immutable, with structural sharing.** Editing one step returns a new
 *    pattern that reuses every clip, lane and step that did not change. That
 *    sharing is what lets nonchalant diff the result in time proportional to
 *    what actually changed, and send a patch naming only those paths.
 * 2. **No change means the same object.** An out-of-range index returns the
 *    input unchanged rather than a fresh equal copy, so the process can skip
 *    the yield entirely and nothing downstream wakes up.
 */

/** Replace `array[index]` with `fn(array[index])`, sharing everything else. */
function mapAt<T>(array: T[], index: number, fn: (item: T) => T): T[] {
  const item = array[index];
  if (item === undefined) return array;
  const next = fn(item);
  if (next === item) return array;
  const copy = array.slice();
  copy[index] = next;
  return copy;
}

function removeAt<T>(array: T[], index: number): T[] {
  if (index < 0 || index >= array.length) return array;
  return array.filter((_, i) => i !== index);
}

function withClips(pattern: Pattern, clips: Clip[]): Pattern {
  return clips === pattern.clips ? pattern : { ...pattern, clips };
}

function withLanes(clip: Clip, lanes: Lane[]): Clip {
  return lanes === clip.lanes ? clip : { ...clip, lanes };
}

/** Apply `fn` to one clip, leaving the rest of the pattern shared. */
function editClip(
  pattern: Pattern,
  clipIndex: number,
  fn: (clip: Clip) => Clip
): Pattern {
  return withClips(pattern, mapAt(pattern.clips, clipIndex, fn));
}

/** Apply `fn` to one lane, leaving the rest of the pattern shared. */
function editLane(
  pattern: Pattern,
  clipIndex: number,
  laneIndex: number,
  fn: (lane: Lane) => Lane
): Pattern {
  return editClip(pattern, clipIndex, (clip) =>
    withLanes(clip, mapAt(clip.lanes, laneIndex, fn))
  );
}

export function renamePattern(pattern: Pattern, name: string): Pattern {
  return name === pattern.name ? pattern : { ...pattern, name };
}

export function addClip(pattern: Pattern): Pattern {
  const clip = emptyClip(`Clip ${pattern.clips.length + 1}`, 1);
  return { ...pattern, clips: [...pattern.clips, clip] };
}

export function removeClip(pattern: Pattern, clipIndex: number): Pattern {
  return withClips(pattern, removeAt(pattern.clips, clipIndex));
}

export function updateClip(
  pattern: Pattern,
  clipIndex: number,
  patch: ClipPatch
): Pattern {
  return editClip(pattern, clipIndex, (clip) => ({ ...clip, ...patch }));
}

export function addLane(pattern: Pattern, clipIndex: number): Pattern {
  return editClip(pattern, clipIndex, (clip) =>
    withLanes(clip, [...clip.lanes, emptyLane()])
  );
}

export function removeLane(
  pattern: Pattern,
  clipIndex: number,
  laneIndex: number
): Pattern {
  return editClip(pattern, clipIndex, (clip) =>
    withLanes(clip, removeAt(clip.lanes, laneIndex))
  );
}

export function updateLane(
  pattern: Pattern,
  clipIndex: number,
  laneIndex: number,
  patch: LanePatch
): Pattern {
  return editLane(pattern, clipIndex, laneIndex, (lane) => ({
    ...lane,
    ...patch,
  }));
}

/**
 * Turn a step on if it is off and off if it is on.
 *
 * `Lane.steps` is a sparse map, so a rest is the *absence* of a key rather
 * than a falsy value - which is what makes shrinking a clip non-destructive.
 */
export function toggleStep(
  pattern: Pattern,
  clipIndex: number,
  laneIndex: number,
  stepIndex: number
): Pattern {
  return editLane(pattern, clipIndex, laneIndex, (lane) => {
    const steps: Record<number, Step> = { ...lane.steps };
    if (steps[stepIndex]) delete steps[stepIndex];
    else steps[stepIndex] = makeStep();
    return { ...lane, steps };
  });
}
