// MetronomeWorker.ts

import type { Input, Output } from "./MetronomeMessage";

// -----------------------------------------------------------------------------
// Global State
// -----------------------------------------------------------------------------
let bpm = 120;
let ppq = 24;
let running = false;
let tickInterval = calculateTickInterval();
let lastTickTime: number | null = null;

// Example: 16th-note pattern with four on the floor (kick on beats 0,4,8,12)
let patternMap: Record<number, number[]> = {
  0: [36],
  2: [36],
  4: [37],
  8: [36],
  11: [36],
  12: [37],
};
const patternLength = 16; // steps per measure (16th notes in 4/4)
const patternDivision = 4; // 4/4 time signature
let pulseCount = 0; // increments every single PPQ pulse

// Each 16th note = ppq/4 pulses, if ppq=24 => 6 pulses per 16th
function pulsesPerStep() {
  return ppq / (patternLength / patternDivision);
}

function calculateTickInterval() {
  return (60 / bpm / ppq) * 1000;
}

// We'll store which notes are currently active to schedule note-offs
interface ActiveNote {
  note: number;
  offTime: number;
}
let activeNotes: ActiveNote[] = [];

// -----------------------------------------------------------------------------
// Message Handling
// -----------------------------------------------------------------------------
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
      patternMap = message.pattern;
      break;

    case "start":
      if (!running) {
        running = true;
        pulseCount = 0;
        lastTickTime = performance.now();
        activeNotes = [];
        scheduleTicks();
        postMessage({ type: "started" } satisfies Output);
      }
      break;

    case "stop":
      running = false;
      lastTickTime = null;
      activeNotes = [];
      postMessage({ type: "stopped" } satisfies Output);
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

    // Post a tick message (for UI / debugging)
    postTickMessage(performance.now());

    elapsed = performance.now() - lastTickTime;

    // Advance time and pulses
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
      postNoteOffMessage(n.note, currentTime);
    } else {
      stillActive.push(n);
    }
  }
  activeNotes = stillActive;
}

function handleNoteOns(currentTime: number) {
  // If the new pulseCount is exactly on a new step boundary...
  // e.g., step boundary every `pulsesPerStep()` pulses
  if (pulseCount % pulsesPerStep() === 0) {
    const stepIndex = (pulseCount / pulsesPerStep()) % patternLength;
    const notes = patternMap[stepIndex] || [];
    notes.forEach((note) => {
      postNoteOnMessage(note, currentTime);

      // Schedule note_off one step later
      const stepMs = pulsesPerStep() * tickInterval;
      activeNotes.push({
        note,
        offTime: currentTime + stepMs,
      });
    });
  }
}

function postNoteOnMessage(note: number, time: number) {
  postMessage({
    type: "note_on",
    channel: 10,
    note,
    velocity: 100,
    time,
  } as Output);
}

function postNoteOffMessage(note: number, time: number) {
  postMessage({
    type: "note_off",
    channel: 10,
    note,
    time,
  } as Output);
}

function postTickMessage(currentTime: number) {
  postMessage({
    type: "tick",
    time: currentTime,
    playhead: (pulseCount / pulsesPerStep()) % patternLength,
    pulse: pulseCount,
  } as Output);
}
