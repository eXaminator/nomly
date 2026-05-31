"use client";

import * as React from "react";
import { Ban, BookOpen, Check, MoreVertical, Pencil, Tags, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  ShoppingItemAmount,
  ShoppingItemManualAmount,
  ShoppingItemSourceView,
  ShoppingItemStapleSourceView,
  ShoppingItemView,
} from "@/lib/shopping/items";
import { formatQty } from "@/lib/shopping/format";
import { cn } from "@/lib/cn";

type Props = {
  item: ShoppingItemView;
  /** When set, "Hier nicht verfügbar" toggles for this supermarket. */
  activeSupermarketId: number | null;
  /** Opens the recipe preview dialog. Triggered from the context menu. */
  onPreviewRecipe: (recipeId: number) => void;
  onToggle: (item: ShoppingItemView) => void;
  /** Opens the edit dialog for this row's item. */
  onEdit: (item: ShoppingItemView) => void;
  /** Opens the article (ingredient) editor for this row's linked article. */
  onEditArticle: (ingredientId: number) => void;
  onDelete: (id: number) => Promise<void>;
  onToggleUnavailable: (item: ShoppingItemView, supermarketId: number) => Promise<void>;
  /** When true, all non-toggle actions (edit, delete, unavailable) are disabled. */
  disabledOffline?: boolean;
};

export function ShoppingItemRow({
  item,
  activeSupermarketId,
  onPreviewRecipe,
  onToggle,
  onEdit,
  onEditArticle,
  onDelete,
  onToggleUnavailable,
  disabledOffline = false,
}: Props) {
  const isUnavailableHere =
    activeSupermarketId != null &&
    item.unavailableSupermarketIds.includes(activeSupermarketId);

  return (
    <div
      role="button"
      tabIndex={0}
      data-shopping-row
      data-checked={item.checked ? "true" : "false"}
      data-toggle
      onClick={() => onToggle(item)}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onToggle(item);
        }
      }}
      aria-pressed={item.checked}
      aria-label={item.checked ? "Rückgängig" : "Abhaken"}
      className={cn(
        "group flex cursor-pointer items-center gap-2 px-2 py-2 sm:px-3 transition-colors",
        item.checked ? "opacity-60" : "hover:bg-[var(--color-muted)]/40",
      )}
    >
      <span className="flex w-7 shrink-0 items-center justify-center">
        <span
          className={cn(
            "inline-flex size-5 items-center justify-center rounded-md border-2 transition-colors",
            item.checked
              ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
              : "border-[var(--color-border)] bg-[var(--color-bg)]",
          )}
        >
          {item.checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
        </span>
      </span>

      <div className="min-w-0 flex-1 text-left">
        <div className="flex flex-col gap-1">
          <div
            className={cn(
              "flex flex-wrap items-baseline gap-x-2 gap-y-0.5",
              item.checked && "line-through",
            )}
          >
            <span className="font-medium" data-item-name>{item.name}</span>
            <AmountList amounts={item.amounts} />
            {item.note ? (
              <span className="text-xs text-[var(--color-muted-fg)]">
                · {item.note}
              </span>
            ) : null}
            {isUnavailableHere ? (
              <span className="rounded-full bg-[color-mix(in_srgb,var(--color-danger),transparent_90%)] px-2 py-0.5 text-xs text-[var(--color-danger)]">
                Hier nicht verfügbar
              </span>
            ) : null}
          </div>
          {item.sources.length > 0 ||
          item.stapleSources.length > 0 ||
          item.manualAmounts.length > 0 ? (
            <ul className="flex flex-col gap-0.5 text-xs text-[var(--color-muted-fg)]">
              {item.sources.map((s) => (
                <SourceLine key={`src-${s.sourceId}`} source={s} />
              ))}
              {item.stapleSources.map((s) => (
                <StapleLine key={`stp-${s.sourceId}`} staple={s} />
              ))}
              {item.manualAmounts.map((m) => (
                <ManualLine key={`man-${m.id}`} manual={m} />
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Aktionen" title="Aktionen">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => onEdit(item)}
              disabled={disabledOffline}
            >
              <Pencil className="mr-2 size-4" />
              Eintrag bearbeiten
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onEditArticle(item.refId)}
              disabled={disabledOffline}
            >
              <Tags className="mr-2 size-4" />
              Artikel bearbeiten
            </DropdownMenuItem>
            <RecipeMenuEntry sources={item.sources} onPreview={onPreviewRecipe} />
            <DropdownMenuItem
              onClick={() =>
                activeSupermarketId != null
                  ? void onToggleUnavailable(item, activeSupermarketId)
                  : undefined
              }
              disabled={activeSupermarketId == null || disabledOffline}
              className="text-[var(--color-fg)]"
            >
              <Ban className="mr-2 size-4" />
              {isUnavailableHere ? "Hier verfügbar markieren" : "Hier nicht verfügbar"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void onDelete(item.id)}
              className="text-[var(--color-danger)]"
              disabled={disabledOffline}
            >
              <Trash2 className="mr-2 size-4" />
              Löschen
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function AmountList({ amounts }: { amounts: ShoppingItemAmount[] }) {
  const visible = amounts.filter(
    (a) => a.quantity != null || a.unitName != null,
  );
  if (visible.length === 0) return null;
  return (
    <span className="text-sm text-[var(--color-muted-fg)]">
      {visible.map((a, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <span className="mx-1">+</span> : null}
          <span>
            {a.quantity != null ? formatQty(a.quantity) : ""}
            {a.unitName ? `${a.quantity != null ? " " : ""}${a.unitName}` : ""}
            {a.baseQuantity != null && a.baseUnitName
              ? ` (${formatQty(a.baseQuantity)} ${a.baseUnitName})`
              : ""}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
}

function ManualLine({ manual }: { manual: ShoppingItemManualAmount }) {
  return (
    <li className="inline-flex flex-wrap items-baseline gap-x-1.5 px-1">
      <span className="font-medium text-[var(--color-fg)]/80">Manuell</span>
      {manual.quantity != null || manual.unitName ? (
        <span>
          {manual.quantity != null ? formatQty(manual.quantity) : ""}
          {manual.unitName ? ` ${manual.unitName}` : ""}
        </span>
      ) : null}
    </li>
  );
}

function SourceLine({ source }: { source: ShoppingItemSourceView }) {
  return (
    <li className="inline-flex flex-wrap items-baseline gap-x-1.5 px-1">
      <span className="font-medium text-[var(--color-fg)]/80">{source.recipeTitle}</span>
      <span>({formatDate(source.mealDate)})</span>
      {(() => {
        const unitLabel = source.contributedUnit;
        if (source.contributedQuantity == null && !unitLabel) return null;
        return (
          <span>
            {source.contributedQuantity != null
              ? formatQty(source.contributedQuantity)
              : ""}
            {unitLabel ? ` ${unitLabel}` : ""}
          </span>
        );
      })()}
      {source.recipeNotes ? <span>· {source.recipeNotes}</span> : null}
      {source.mealNote ? (
        <span className="italic">· {source.mealNote}</span>
      ) : null}
    </li>
  );
}

function StapleLine({ staple }: { staple: ShoppingItemStapleSourceView }) {
  return (
    <li className="inline-flex flex-wrap items-baseline gap-x-1.5 px-1">
      <span className="font-medium text-[var(--color-fg)]/80">
        {staple.stapleGroupName}
      </span>
      <span className="uppercase tracking-wider">Standard</span>
      {staple.contributedQuantity != null || staple.contributedUnit ? (
        <span>
          {staple.contributedQuantity != null
            ? formatQty(staple.contributedQuantity)
            : ""}
          {staple.contributedUnit ? ` ${staple.contributedUnit}` : ""}
        </span>
      ) : null}
    </li>
  );
}

function RecipeMenuEntry({
  sources,
  onPreview,
}: {
  sources: ShoppingItemSourceView[];
  onPreview: (recipeId: number) => void;
}) {
  if (sources.length === 0) return null;
  const uniqueByRecipe = new Map<number, ShoppingItemSourceView>();
  for (const s of sources) {
    if (!uniqueByRecipe.has(s.recipeId)) uniqueByRecipe.set(s.recipeId, s);
  }
  const unique = Array.from(uniqueByRecipe.values());
  if (unique.length === 1) {
    const only = unique[0];
    return (
      <DropdownMenuItem onClick={() => onPreview(only.recipeId)}>
        <BookOpen className="mr-2 size-4" />
        Rezept öffnen
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <BookOpen className="mr-2 size-4" />
        Rezept öffnen
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {unique.map((s) => (
          <DropdownMenuItem key={s.recipeId} onClick={() => onPreview(s.recipeId)}>
            {s.recipeTitle}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function formatDate(iso: string): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  const weekday = dt.toLocaleDateString("de-DE", {
    weekday: "short",
    timeZone: "UTC",
  });
  const dm = dt.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
  return `${weekday}, ${dm}`;
}
