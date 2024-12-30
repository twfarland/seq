onmessage = (event) => {
  const { bpm, ppq, command } = event.data;
  const tickInterval = (60 / bpm / ppq) * 1000; // Interval in milliseconds

  let running = false;

  const scheduleTicks = () => {
    if (!running) return;

    postMessage("tick");
    setTimeout(scheduleTicks, tickInterval); // Schedule next tick
  };

  if (command === "start") {
    running = true;
    scheduleTicks();
  } else if (command === "stop") {
    running = false;
  }
};
