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
 * Native listeners are required: synthetic React events route through React's
 * own root, so stopping a synthetic event would not stop react-remove-scroll's
 * native `document` listener.
 *
 * @param ref     the scroll container (the element with `overflow: auto`)
 * @param enabled gate the listeners (e.g. only while the popover is open) so
 *                the ref is attached after the content has mounted
 */
export function useScrollLockBypass(
  ref: React.RefObject<HTMLElement | null>,
  enabled = true,
) {
  React.useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener("touchmove", stop, { passive: true });
    el.addEventListener("wheel", stop, { passive: true });
    return () => {
      el.removeEventListener("touchmove", stop);
      el.removeEventListener("wheel", stop);
    };
  }, [ref, enabled]);
}
