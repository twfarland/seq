// Define input messages
type WorkerInput =
  | { type: "set_bpm"; bpm: number }
  | { type: "set_ppq"; ppq: number }
  | { type: "start" }
  | { type: "stop" };

// Define output messages
type WorkerOutput = { type: "tick"; time: number };

const calculateTickInterval = (bpm: number, ppq: number) =>
  (60 / bpm / ppq) * 1000;

// State management
let bpm = 120; // Default BPM
let ppq = 24; // Default PPQ
let running = false;
let tickInterval = calculateTickInterval(bpm, ppq); // Milliseconds per tick
let lastTickTime: number | null = null;

onmessage = (event: MessageEvent<WorkerInput>) => {
  const message = event.data;

  switch (message.type) {
    case "set_bpm":
      bpm = message.bpm;
      tickInterval = calculateTickInterval(bpm, ppq);
      break;

    case "set_ppq":
      ppq = message.ppq;
      tickInterval = calculateTickInterval(bpm, ppq);
      break;

    case "start":
      if (!running) {
        running = true;
        lastTickTime = performance.now();
        scheduleTicks();
      }
      break;

    case "stop":
      running = false;
      lastTickTime = null;
      break;
  }
};

const scheduleTicks = () => {
  if (!running) return;

  const now = performance.now();
  if (lastTickTime !== null) {
    const elapsed = now - lastTickTime;

    // Post tick message if enough time has passed
    if (elapsed >= tickInterval) {
      postMessage({
        type: "tick",
        time: now,
      } satisfies WorkerOutput);
      lastTickTime += tickInterval; // Adjust for drift
    }
  } else {
    lastTickTime = now;
  }

  // Schedule next tick with drift compensation
  setTimeout(
    () => scheduleTicks(),
    Math.max(0, tickInterval - (performance.now() - lastTickTime!))
  );
};
