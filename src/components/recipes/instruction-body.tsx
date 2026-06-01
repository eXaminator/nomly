"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DietMarker } from "@/components/recipes/diet-marker";
import { RecipeIngredientReadLine } from "@/components/recipes/ingredient-read-line";
import type { IngredientDietaryClass } from "@/lib/recipes/diet";

/** The subset of an ingredient row needed to render one tooltip line. */
export type MentionTip = {
  quantity: number | null;
  unitLabel: string | null;
  name: string;
  canonicalName: string | null;
  notes: string | null;
  isOptional: boolean;
  fixedAmount: boolean;
  dietaryClass: IngredientDietaryClass;
};

/** All the rows for one mention. Index in the outer array is the `data-mention`
 *  id emitted by highlightIngredientMentions; the inner array is every list
 *  entry for that ingredient (>1 when it's listed multiple times in a section,
 *  e.g. once for the dough and once for the topping). */
export type MentionTips = MentionTip[][];

type Active = { rows: MentionTip[]; x: number; y: number; below: boolean };

// Half the tooltip's max width — used to keep it on screen near the edges.
const HALF_WIDTH = 150;
// Below this distance from the top of the viewport, flip the tooltip below the
// word so it doesn't get clipped at the top edge.
const FLIP_THRESHOLD = 150;

/**
 * Renders the (already highlighted) instruction HTML and shows a rich tooltip
 * for each ingredient mention on hover / keyboard focus / tap. The tooltip
 * reuses {@link RecipeIngredientReadLine} + {@link DietMarker} so it matches the
 * ingredient list exactly — same colors, the "– note", "(optional)", and the
 * diet icon. A client component because the spans live inside
 * `dangerouslySetInnerHTML`, so we resolve them through delegated DOM events.
 */
export function InstructionBody({
  html,
  tips,
}: {
  html: string;
  tips: MentionTips;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Active | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const resolveSpan = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null;
      const span = target.closest<HTMLElement>(
        ".ingredient-mention[data-mention]",
      );
      return span && el.contains(span) ? span : null;
    };

    const open = (span: HTMLElement) => {
      const rows = tips[Number(span.dataset.mention)];
      if (!rows || rows.length === 0) {
        setActive(null);
        return;
      }
      const r = span.getBoundingClientRect();
      const cx = Math.min(
        Math.max(r.left + r.width / 2, HALF_WIDTH + 8),
        window.innerWidth - HALF_WIDTH - 8,
      );
      const below = r.top < FLIP_THRESHOLD;
      setActive({ rows, x: cx, y: below ? r.bottom + 8 : r.top - 8, below });
    };

    const onPointerOver = (e: PointerEvent) => {
      const span = resolveSpan(e.target);
      if (span) open(span);
      else setActive(null);
    };
    const onFocusIn = (e: FocusEvent) => {
      const span = resolveSpan(e.target);
      if (span) open(span);
    };
    const dismiss = () => setActive(null);

    el.addEventListener("pointerover", onPointerOver);
    el.addEventListener("pointerleave", dismiss);
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", dismiss);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      el.removeEventListener("pointerover", onPointerOver);
      el.removeEventListener("pointerleave", dismiss);
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [tips]);

  return (
    <>
      <div
        ref={containerRef}
        className="markdown markdown-steps text-[var(--color-fg)]"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {active && typeof document !== "undefined"
        ? createPortal(
            <div
              role="tooltip"
              className="pointer-events-none fixed z-50 w-max max-w-[300px] space-y-1 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-card-fg)] shadow-lg"
              style={{
                left: active.x,
                top: active.y,
                transform: `translateX(-50%) translateY(${
                  active.below ? "0" : "-100%"
                })`,
              }}
            >
              {active.rows.map((row, i) => (
                <div key={i} className="flex items-start gap-2">
                  <DietMarker kind={row.dietaryClass} />
                  <RecipeIngredientReadLine
                    quantity={row.quantity}
                    unitLabel={row.unitLabel}
                    name={row.name}
                    canonicalName={row.canonicalName}
                    notes={row.notes}
                    isOptional={row.isOptional}
                    isAlternative={false}
                    fixedAmount={row.fixedAmount}
                  />
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
