import { Show } from "solid-js";

/**
 * Small labelled inputs shared by the editors.
 *
 * They exist mainly to centralise one rule: a partially-typed number field
 * (empty, "-", "1e") reports `NaN`, and forwarding that would poison the
 * pattern - a `NaN` BPM once meant an infinite tick interval and a frozen tab.
 * `valueAsNumber` plus the guard below keeps bad input from ever leaving the
 * component, while the caller's own clamping handles merely out-of-range input.
 */

export interface NumberFieldProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** Rendered after the input, e.g. a unit or a validation hint. */
  suffix?: string;
  title?: string;
  onChange: (value: number) => void;
}

export function NumberField(props: NumberFieldProps) {
  return (
    <label class="field" title={props.title ?? ""}>
      <span class="field__label">{props.label}</span>
      <input
        class="field__input"
        type="number"
        inputmode="numeric"
        value={props.value}
        min={props.min ?? ""}
        max={props.max ?? ""}
        step={props.step ?? 1}
        onInput={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (!Number.isNaN(next)) props.onChange(next);
        }}
      />
      <Show when={props.suffix}>
        {(suffix) => <span class="field__suffix">{suffix()}</span>}
      </Show>
    </label>
  );
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export function TextField(props: TextFieldProps) {
  return (
    <label class="field">
      <span class="field__label">{props.label}</span>
      <input
        class="field__input"
        type="text"
        value={props.value}
        onInput={(event) => props.onChange(event.currentTarget.value)}
      />
    </label>
  );
}
