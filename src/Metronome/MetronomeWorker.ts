// MetronomeWorker.ts

import type { Input, Output } from "./MetronomeMessage";
import { Clip, Pattern } from "./Pattern";

// -----------------------------------------------------------------------------
// Global State
// -----------------------------------------------------------------------------
let bpm = 120;
let ppq = 24;
let running = false;
let tickInterval = calculateTickInterval();
let lastTickTime: number | null = null;
let pattern: Pattern = {
  name: "default",
  clips: [],
};
let activeNotes: ActiveNote[] = [];
let pulseCount = 0; // increments every single PPQ pulse

function calculateTickInterval() {
  return (60 / bpm / ppq) * 1000;
}

// Helper to calculate pulses per step for each clip:
function pulsesPerClipStep(clip: Clip): number {
  return ppq / clip.subdivisionPerBeat;
}

// We'll store which notes are currently active to schedule note-offs
// @TODO improve this data structure
interface ActiveNote {
  note: number;
  offTime: number;
  channel: number;
}

// -----------------------------------------------------------------------------
// Message Handling
// -----------------------------------------------------------------------------

const postOutputMessage = <O extends Output>(message: O) =>
  postMessage(message);

onmessage = (event: MessageEvent<Input>) => {
  const message = event.data;

  switch (message.type) {
    case "set_bpm":
      bpm = message.bpm;
      tickInterval = calculateTickInterval();
      break;

    case "set_ppq":
      ppq = message.ppq;
      tickInterval = calculateTickInterval();
      break;

    case "set_pattern":
      pattern = message.pattern;
      break;

    case "start":
      if (!running) {
        running = true;
        pulseCount = 0;
        lastTickTime = performance.now();
        activeNotes = [];
        scheduleTicks();
        postOutputMessage({ type: "started" });
      }
      break;

    case "stop":
      running = false;
      lastTickTime = null;
      activeNotes = [];
      postOutputMessage({ type: "stopped" });
      break;
  }
};

// -----------------------------------------------------------------------------
// Main Loop
// -----------------------------------------------------------------------------

function scheduleTicks() {
  if (!running) return;

  const now = performance.now();
  if (lastTickTime === null) {
    lastTickTime = now;
  }

  let elapsed = now - lastTickTime;

  // If system lagged, don't skip pulses
  while (elapsed >= tickInterval) {
    // First handle any note-offs (so old notes end before new ones start)
    handleNoteOffs(performance.now());

    // Then check if we hit a step boundary => note on
    handleNoteOns(performance.now());

    // Post a tick message for midi sync
    postOutputMessage({
      type: "tick",
      time: performance.now(),
      pulse: pulseCount,
    });

    // Advance time and pulses
    elapsed = performance.now() - lastTickTime;
    lastTickTime += tickInterval;
    pulseCount++;
  }

  // Re-schedule
  setTimeout(
    scheduleTicks,
    Math.max(0, tickInterval - (performance.now() - lastTickTime))
  );
}

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

function handleNoteOffs(currentTime: number) {
  if (activeNotes.length === 0) return;
  const stillActive: ActiveNote[] = [];

  for (const n of activeNotes) {
    if (n.offTime <= currentTime) {
      postOutputMessage({
        type: "note_off",
        channel: n.channel,
        note: n.note,
        time: currentTime,
      });
    } else {
      stillActive.push(n);
    }
  }
  activeNotes = stillActive;
}

function handleNoteOns(currentTime: number) {
  for (const [clipIndex, clip] of pattern.clips.entries()) {
    // figure out if this clip hits a step boundary
    const clipStepPulses = pulsesPerClipStep(clip);
    if (pulseCount % clipStepPulses === 0) {
      const totalSteps = clip.beatsPerMeasure * clip.subdivisionPerBeat;
      const stepIndex = (pulseCount / clipStepPulses) % totalSteps;

      // post a step message that includes the clip index
      postOutputMessage({
        type: "step",
        clipIndex,
        stepIndex,
        time: currentTime,
      });

      // now fire notes for this clip
      for (const lane of clip.lanes) {
        const step = lane.steps[stepIndex];
        if (!step) {
          continue;
        }

        // note on
        postOutputMessage({
          type: "note_on",
          time: currentTime,
          midiNote: lane.midiNote,
          channel: clip.channel,
          velocity: step.velocity,
        });

        // schedule note off using *this clip's* step pulses
        const stepMs = clipStepPulses * tickInterval * step.lengthInSteps;
        activeNotes.push({
          note: lane.midiNote,
          offTime: currentTime + stepMs,
          channel: clip.channel,
        });
      }
    }
  }
}
