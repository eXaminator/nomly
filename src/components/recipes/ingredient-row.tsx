"use client";

import * as React from "react";
import { AlertTriangle, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SelectSearch,
  type SelectSearchItem,
} from "@/components/ui/select-search";
import { cn } from "@/lib/cn";
import { IngredientNameInput } from "./ingredient-name-input";
import type { DraftIngredient, ImportAnnotation } from "./types";

async function searchUnits(q: string): Promise<SelectSearchItem[]> {
  const r = await fetch(`/api/v1/units?q=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  const data = (await r.json()) as {
    items: Array<{ id: number; name: string; matchedAlias?: string }>;
  };
  return data.items.map((i) => ({
    id: i.id,
    name: i.name,
    detail:
      i.matchedAlias && i.matchedAlias !== i.name ? `≈ ${i.matchedAlias}` : undefined,
  }));
}

async function createUnit(name: string): Promise<SelectSearchItem> {
  // Inline-created units default to dimension="count" since the import form
  // can't ask the user to pick a dimension. Richer edits live in Epic 7.
  const r = await fetch("/api/v1/units", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, dimension: "count" }),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${r.status}`);
  }
  const data = (await r.json()) as { id: number; name: string };
  return { id: data.id, name: data.name };
}

async function loadDefaultUnits(): Promise<SelectSearchItem[]> {
  return searchUnits("");
}

type Props = {
  value: DraftIngredient;
  onChange: (next: DraftIngredient) => void;
  onRemove: () => void;
};

export function IngredientRow({ value, onChange, onRemove }: Props) {
  const [defaultUnits, setDefaultUnits] = React.useState<SelectSearchItem[]>([]);
  React.useEffect(() => {
    void loadDefaultUnits().then(setDefaultUnits);
  }, []);

  // When the user edits a field, the matching badge from the import is no
  // longer accurate. Drop the relevant flag — but keep the rest of the
  // annotation so the row still surfaces what hasn't been resolved.
  function clearAnnotationOn(
    annotation: ImportAnnotation | undefined,
    field: "ingredient" | "unit",
  ): ImportAnnotation | undefined {
    if (!annotation) return annotation;
    if (field === "ingredient" && annotation.ingredientIsNew) {
      const next = { ...annotation, ingredientIsNew: false };
      if (!annotationShowsAnything(next)) return undefined;
      return next;
    }
    if (field === "unit" && annotation.unitState !== "ok") {
      const next: ImportAnnotation = {
        ...annotation,
        unitState: "ok",
        rawUnit: null,
      };
      if (!annotationShowsAnything(next)) return undefined;
      return next;
    }
    return annotation;
  }

  return (
    <div className="grid grid-cols-[5rem_8rem_1fr_auto] gap-2 md:grid-cols-[5rem_8rem_1fr_1fr_auto]">
      <Input
        inputMode="decimal"
        placeholder="Menge"
        value={value.quantity}
        onChange={(e) => onChange({ ...value, quantity: e.target.value })}
        aria-label="Menge"
      />
      <div className="flex flex-col gap-1">
        <SelectSearch
          value={value.unit}
          onChange={(unit) =>
            onChange({
              ...value,
              unit,
              importAnnotation: clearAnnotationOn(value.importAnnotation, "unit"),
            })
          }
          search={searchUnits}
          defaultItems={defaultUnits}
          placeholder="Einheit"
          onCreate={createUnit}
          createLabelPrefix="als Einheit anlegen"
        />
        <UnitBadge annotation={value.importAnnotation} />
      </div>
      <div className="col-span-2 flex flex-col gap-1 md:col-span-1">
        <IngredientNameInput
          value={value.name}
          onChange={(name, canonical) =>
            onChange({
              ...value,
              name,
              // When `canonical` is undefined, leave the existing value
              // alone (the user is still typing in-place); when it's an
              // explicit `null` the input is telling us to clear it; when
              // it's a string, an alias was picked.
              canonicalName:
                canonical === undefined ? value.canonicalName : canonical,
              importAnnotation: clearAnnotationOn(value.importAnnotation, "ingredient"),
            })
          }
          placeholder="Zutat"
        />
        <IngredientBadge
          annotation={value.importAnnotation}
          canonicalName={value.canonicalName}
          displayName={value.name}
        />
      </div>
      <Input
        placeholder="Notiz (z. B. fein gehackt)"
        value={value.notes}
        onChange={(e) => onChange({ ...value, notes: e.target.value })}
        aria-label="Notiz"
        className="col-span-3 md:col-span-1"
      />
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label="Zutat entfernen"
        className="col-start-4 md:col-start-5"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function annotationShowsAnything(a: ImportAnnotation): boolean {
  return (
    a.ingredientIsNew ||
    a.unitState === "defaulted" ||
    a.unitState === "unresolved"
  );
}

function IngredientBadge({
  annotation,
  canonicalName,
  displayName,
}: {
  annotation: ImportAnnotation | undefined;
  canonicalName: string | null;
  displayName: string;
}) {
  if (annotation?.ingredientIsNew) {
    return (
      <span
        className={cn(
          "inline-flex w-fit items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--color-warning),var(--color-bg)_82%)] px-2 py-0.5 text-xs font-medium text-[var(--color-warning)]",
        )}
        title="Zutat existiert noch nicht und wird beim Speichern angelegt."
      >
        <Sparkles className="size-3" />
        Neu
      </span>
    );
  }
  if (
    canonicalName &&
    canonicalName.trim().length > 0 &&
    canonicalName.toLowerCase() !== displayName.trim().toLowerCase()
  ) {
    return (
      <span
        className="inline-flex w-fit max-w-full items-center gap-1 truncate rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs text-[var(--color-muted-fg)]"
        title={`Zugeordnet zu „${canonicalName}".`}
      >
        = {canonicalName}
      </span>
    );
  }
  return null;
}

function UnitBadge({
  annotation,
}: {
  annotation: ImportAnnotation | undefined;
}) {
  if (!annotation) return null;
  if (annotation.unitState === "unresolved") {
    return (
      <span
        className="inline-flex w-fit items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--color-danger),var(--color-bg)_82%)] px-2 py-0.5 text-xs font-medium text-[var(--color-danger)]"
        title={
          annotation.rawUnit
            ? `„${annotation.rawUnit}" konnte keiner bekannten Einheit zugeordnet werden. Wähle eine passende Einheit oder leg sie neu an.`
            : undefined
        }
      >
        <AlertTriangle className="size-3" />
        Einheit „{annotation.rawUnit}“ unbekannt
      </span>
    );
  }
  if (annotation.unitState === "defaulted") {
    return (
      <span
        className="inline-flex w-fit items-center gap-1 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs text-[var(--color-muted-fg)]"
        title="Es wurde keine Einheit erkannt — Standard ‚Stück'."
      >
        Standard: Stück
      </span>
    );
  }
  if (annotation.unitState === "synonym" && annotation.rawUnit) {
    return (
      <span
        className="inline-flex w-fit max-w-full items-center gap-1 truncate rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs text-[var(--color-muted-fg)]"
        title={`Importiert als „${annotation.rawUnit}".`}
      >
        {annotation.rawUnit}
      </span>
    );
  }
  return null;
}
