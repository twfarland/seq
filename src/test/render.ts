import type { VNode } from "@nonchalant/core";
import { mount } from "@nonchalant/dom";

/**
 * Mounting helpers for the view suites.
 *
 * A view is called once and returns plain data; what stays live is the
 * bindings inside it. So these tests mount, drive the processes underneath, let
 * the effects flush, and then look at the DOM - there is no re-render to await.
 */

/** Let queued effects run and any mailbox in flight drain. */
export const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

export interface Rendered {
  container: HTMLElement;
  [Symbol.dispose](): void;
}

export function render(view: VNode): Rendered {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const handle = mount(container, view);

  return {
    container,
    [Symbol.dispose]: () => {
      handle[Symbol.dispose]();
      container.remove();
    },
  };
}

/** Every DOM change under `root`, as a list of the elements that were touched. */
export function watchWrites(root: Element) {
  const touched: Element[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target =
        record.target.nodeType === Node.ELEMENT_NODE
          ? (record.target as Element)
          : record.target.parentElement;
      if (target) touched.push(target);
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });

  return {
    /** Drain the queue: MutationObserver delivers on a microtask. */
    async take(): Promise<Element[]> {
      await settle();
      const seen = touched.splice(0);
      return seen;
    },
    stop: () => observer.disconnect(),
  };
}
