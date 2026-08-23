import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { NumberField, TextField } from "./Fields";

describe("NumberField", () => {
  it("reports each valid value the user types", async () => {
    const onChange = vi.fn();
    render(() => <NumberField label="BPM" value={120} onChange={onChange} />);

    const input = screen.getByLabelText("BPM");
    await userEvent.clear(input);
    await userEvent.type(input, "9");

    expect(onChange).toHaveBeenLastCalledWith(9);
  });

  it("swallows a cleared field instead of reporting NaN", async () => {
    // Regression: `+e.currentTarget.value` turned "" into 0, and a BPM of 0
    // produced an infinite tick interval that locked up the tab.
    const onChange = vi.fn();
    render(() => <NumberField label="BPM" value={120} onChange={onChange} />);

    await userEvent.clear(screen.getByLabelText("BPM"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps showing the last committed value after invalid input", async () => {
    const [value, setValue] = createSignal(120);
    render(() => (
      <NumberField label="BPM" value={value()} onChange={setValue} />
    ));

    const input = screen.getByLabelText<HTMLInputElement>("BPM");
    await userEvent.clear(input);
    expect(value()).toBe(120);
  });

  it("passes min, max and step through to the control", () => {
    render(() => (
      <NumberField label="Channel" value={10} min={1} max={16} onChange={vi.fn()} />
    ));
    const input = screen.getByLabelText<HTMLInputElement>("Channel");
    expect(input).toHaveAttribute("min", "1");
    expect(input).toHaveAttribute("max", "16");
  });

  it("renders a suffix only when one is given", () => {
    const { unmount } = render(() => (
      <NumberField label="PPQ" value={48} suffix="non-standard" onChange={vi.fn()} />
    ));
    expect(screen.getByText("non-standard")).toBeInTheDocument();
    unmount();

    render(() => <NumberField label="PPQ" value={24} onChange={vi.fn()} />);
    expect(screen.queryByText("non-standard")).not.toBeInTheDocument();
  });
});

describe("TextField", () => {
  it("reports every keystroke", async () => {
    const [value, setValue] = createSignal("");
    render(() => (
      <TextField label="Clip" value={value()} onChange={setValue} />
    ));

    await userEvent.type(screen.getByLabelText("Clip"), "Bass");
    expect(value()).toBe("Bass");
  });
});
