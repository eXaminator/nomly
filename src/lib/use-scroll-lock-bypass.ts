"use client";

import * as React from "react";

/**
 * Lets a scroll container that is portaled outside an open Radix Dialog/Drawer
 * (e.g. a Popover-based select list) scroll normally by touch and wheel.
 *
 * The dialog wraps its body in `react-remove-scroll`, which registers a
 * non-passive, bubble-phase `wheel`/`touchmove` listener on `document` and
 * `preventDefault()`s any such event whose target sits outside the dialog body
 * — which includes a portaled popover, leaving its list dead on mobile. Since
 * that blocker is on `document` in the bubble phase, stopping propagation on
 * the scroll container itself keeps the event from ever reaching it, so the
 * browser performs its normal native (momentum-preserving) scroll. Pair this
 * with `overscroll-behavior: contain` on the element so an over-scroll past an
 * edge doesn't chain into the locked background.
 *
 * Returns a **callback ref** to spread onto the scroll container rather than
 * keying an effect on an `open` flag: Radix mounts the popover content a beat
 * after `open` flips, so an effect would run while the element is still null
 * and never attach. A callback ref fires exactly when the node mounts (and its
 * cleanup when it unmounts), so the listeners always land on the live element.
 * Native listeners are required: synthetic React events route through React's
 * own root, so stopping a synthetic event would not stop react-remove-scroll's
 * native `document` listener.
 *
 * @param ref optional mutable ref kept pointed at the live node, so callers can
 *            still read the element from other effects (scroll-into-view, etc.)
 */
export function useScrollLockBypass<T extends HTMLElement>(
  ref?: { current: T | null },
): (node: T | null) => void {
  return React.useCallback(
    (node: T | null) => {
      if (ref) ref.current = node;
      if (!node) return;
      const stop = (e: Event) => e.stopPropagation();
      node.addEventListener("touchmove", stop, { passive: true });
      node.addEventListener("wheel", stop, { passive: true });
      return () => {
        node.removeEventListener("touchmove", stop);
        node.removeEventListener("wheel", stop);
        if (ref) ref.current = null;
      };
    },
    [ref],
  );
}
