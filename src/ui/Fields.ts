import type { VNode } from "@nonchalant/core";
import { input, label, span } from "@nonchalant/dom/tags";

/**
 * Small labelled inputs shared by the editors.
 *
 * They exist mainly to centralise one rule: a partially-typed number field
 * (empty, "-", "1e") reports `NaN`, and forwarding that would poison the
 * pattern - a `NaN` BPM once meant an infinite tick interval and a frozen tab.
 * `valueAsNumber` plus the guard below keeps bad input from ever leaving the
 * component, while the engine's own clamping handles merely out-of-range input.
 *
 * `value` is a thunk rather than a number: views run once, so the live part of
 * a field is the binding, not a re-render.
 */

const numberFromInput = (event: Event): number =>
  (event.currentTarget as HTMLInputElement).valueAsNumber;

export interface NumberFieldProps {
  label: string;
  value: () => number;
  min?: number;
  max?: number;
  step?: number;
  /** Rendered after the input, e.g. a unit or a validation hint. */
  suffix?: () => string;
  title?: string;
  onChange: (value: number) => void;
}

export function NumberField(props: NumberFieldProps): VNode {
  const suffix = props.suffix;

  return label(
    { class: "field", title: props.title ?? "" },
    span({ class: "field__label" }, props.label),
    input({
      class: "field__input",
      type: "number",
      inputmode: "numeric",
      value: props.value,
      min: props.min ?? "",
      max: props.max ?? "",
      step: props.step ?? 1,
      oninput: (event: Event) => {
        const next = numberFromInput(event);
        if (!Number.isNaN(next)) props.onChange(next);
      },
    }),
    () => {
      const text = suffix?.();
      return text ? span({ class: "field__suffix" }, text) : null;
    }
  );
}

export interface TextFieldProps {
  label: string;
  value: () => string;
  onChange: (value: string) => void;
}

export function TextField(props: TextFieldProps): VNode {
  return label(
    { class: "field" },
    span({ class: "field__label" }, props.label),
    input({
      class: "field__input",
      type: "text",
      value: props.value,
      oninput: (event: Event) =>
        props.onChange((event.currentTarget as HTMLInputElement).value),
    })
  );
}
