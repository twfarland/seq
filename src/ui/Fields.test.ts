import { cell } from "@nonchalant/core";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { render, settle } from "~/test/render";
import { NumberField, TextField } from "./Fields";

/**
 * The fields exist to keep one class of input out of the pattern: a
 * half-typed number. `valueAsNumber` reports `NaN` for an empty field, a lone
 * "-", or "1e", and a `NaN` BPM once meant an infinite tick interval and a
 * frozen tab.
 */

const input = (container: HTMLElement) =>
  container.querySelector("input") as HTMLInputElement;

describe("NumberField", () => {
  it("reports each valid value the user types", async () => {
    const onChange = vi.fn<(value: number) => void>();
    using view = render(
      NumberField({ label: "BPM", value: () => 120, onChange })
    );

    await userEvent.clear(input(view.container));
    await userEvent.type(input(view.container), "14");

    expect(onChange.mock.calls.map(([value]) => value)).toEqual([1, 14]);
  });

  it("swallows a cleared field instead of reporting NaN", async () => {
    const onChange = vi.fn<(value: number) => void>();
    using view = render(
      NumberField({ label: "BPM", value: () => 120, onChange })
    );

    await userEvent.clear(input(view.container));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows what the binding says, and follows it when it changes", async () => {
    const bpm = cell(120);
    using view = render(
      NumberField({ label: "BPM", value: bpm, onChange: () => {} })
    );
    expect(input(view.container).value).toBe("120");

    bpm.cast(90);
    await settle();
    expect(input(view.container).value).toBe("90");
  });

  it("passes min, max and step through to the control", () => {
    using view = render(
      NumberField({
        label: "PPQ",
        value: () => 24,
        min: 1,
        max: 960,
        step: 2,
        onChange: () => {},
      })
    );

    const control = input(view.container);
    expect(control.getAttribute("min")).toBe("1");
    expect(control.getAttribute("max")).toBe("960");
    expect(control.getAttribute("step")).toBe("2");
  });

  it("renders a suffix only when one is given", async () => {
    const suffix = cell("");
    using view = render(
      NumberField({
        label: "PPQ",
        value: () => 24,
        suffix,
        onChange: () => {},
      })
    );
    expect(view.container.querySelector(".field__suffix")).toBeNull();

    suffix.cast("non-standard");
    await settle();
    expect(view.container.querySelector(".field__suffix")?.textContent).toBe(
      "non-standard"
    );
  });
});

describe("TextField", () => {
  it("reports every keystroke", async () => {
    const onChange = vi.fn<(value: string) => void>();
    using view = render(
      TextField({ label: "Clip", value: () => "", onChange })
    );

    await userEvent.type(input(view.container), "kick");

    expect(onChange.mock.calls.map(([value]) => value)).toEqual([
      "k",
      "ki",
      "kic",
      "kick",
    ]);
  });
});
