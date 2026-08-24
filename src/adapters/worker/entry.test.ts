import { connect, portTransport } from "@nonchalant/wire";
import type { MessageEndpoint } from "@nonchalant/wire";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SequencerSchema } from "~/app/messages";
import type { SequencerEvent } from "~/domain/events";

/**
 * The worker file, wired up for real.
 *
 * `app/sequencer.test.ts` drives the process; this one proves the adapter that
 * connects it to a thread. A `MessageChannel` stands in for the worker port, and
 * the module is imported with its globals pointed at one end of it - so the
 * handshake, the registry, the transport and the raw event channel are all the
 * ones that ship.
 *
 * The claim worth having a test for is the last one: two kinds of traffic share
 * this port, and each side has to ignore the other's.
 */

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let channel: MessageChannel;
let saved: Record<string, PropertyDescriptor | undefined>;

/** Point the worker module's globals at one end of the channel. */
function installWorkerGlobals(port: MessagePort) {
  saved = {
    addEventListener: Object.getOwnPropertyDescriptor(
      globalThis,
      "addEventListener"
    ),
    postMessage: Object.getOwnPropertyDescriptor(globalThis, "postMessage"),
  };
  Object.defineProperty(globalThis, "addEventListener", {
    value: (type: string, fn: EventListener) => port.addEventListener(type, fn),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "postMessage", {
    value: (data: unknown) => port.postMessage(data),
    configurable: true,
    writable: true,
  });
  port.start();
}

beforeEach(() => {
  channel = new MessageChannel();
  installWorkerGlobals(channel.port2);
  vi.resetModules();
});

afterEach(() => {
  for (const [name, descriptor] of Object.entries(saved)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  channel.port1.close();
  channel.port2.close();
});

describe("the worker, over a real port", () => {
  it("serves the sequencer and pushes MIDI events beside it", async () => {
    await import("./entry");

    const events: SequencerEvent[] = [];
    channel.port1.addEventListener("message", (event: MessageEvent<unknown>) => {
      // Wire frames are strings and belong to the transport.
      if (typeof event.data === "string") return;
      events.push(...(event.data as SequencerEvent[]));
    });
    channel.port1.start();

    const there = connect<SequencerSchema>(
      portTransport(channel.port1 as unknown as MessageEndpoint)
    );
    const sequencer = there.lookup("sequencer");

    await settle(50);

    // State arrived over the wire, the worker's own clock origin with it.
    expect(sequencer()).toBeDefined();
    expect(sequencer()?.timeOrigin).toBe(performance.timeOrigin);
    expect(sequencer()?.pattern.clips[0]?.lanes[0]?.instrument).toBe("kick");
    expect(events).toHaveLength(0);

    // An edit is a message there and a patch back.
    sequencer.cast({
      type: "toggle_step",
      clipIndex: 0,
      laneIndex: 0,
      stepIndex: 1,
    });
    await settle(50);
    expect(sequencer()?.pattern.clips[0]?.lanes[0]?.steps[1]).toBeDefined();

    // Playing pushes MIDI on the other channel, which the transport ignored.
    sequencer.cast({ type: "start" });
    await settle(100);

    expect(sequencer()?.running).toBe(true);
    expect(events.some((event) => event.type === "note_on")).toBe(true);
    expect(events.some((event) => event.type === "tick")).toBe(true);

    sequencer.cast({ type: "stop" });
    await settle(50);
    expect(sequencer()?.running).toBe(false);

    // Nothing keeps grinding once it is told to stop.
    const settled = events.length;
    await settle(120);
    expect(events).toHaveLength(settled);

    sequencer[Symbol.dispose]();
    there.close();
  });
});
