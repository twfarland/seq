import { render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";

afterEach(() => Reflect.deleteProperty(navigator as object, "requestMIDIAccess"));

describe("App", () => {
  it("renders the shell and degrades gracefully without Web MIDI", async () => {
    // jsdom has no Web MIDI, which is exactly the unsupported-browser path.
    render(() => <App />);

    expect(screen.getByRole("heading", { name: "seq", level: 1 })).toBeInTheDocument();
    expect(
      await screen.findByText(/does not support the Web MIDI API/i)
    ).toBeInTheDocument();
    // With no output selected the sequencer must not mount at all.
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });
});
