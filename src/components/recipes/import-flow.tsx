"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Download,
  Link as LinkIcon,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RecipeForm } from "./recipe-form";
import type {
  DraftIngredient,
  DraftRecipe,
  ImportAnnotation,
} from "./types";

type ImportedRecipeResponse = {
  title: string;
  description: string | null;
  servings: number;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  sourceUrl: string;
  photoPath: string | null;
  tags: string[];
  sections: Array<{
    title: string | null;
    instructions: string;
    ingredients: Array<{
      quantity: number | null;
      unit: { id: number; name: string } | null;
      unitMatch:
        | "matched"
        | "synonym"
        | "defaulted"
        | "unresolved"
        | "empty";
      rawUnit: string | null;
      name: string;
      ingredientId: number | null;
      ingredientMatch: "existing" | "new";
      notes: string | null;
    }>;
  }>;
};

type Props = {
  tagSuggestions: string[];
};

function importedToDraft(
  imported: ImportedRecipeResponse,
): DraftRecipe {
  return {
    title: imported.title,
    description: imported.description ?? "",
    servings: String(imported.servings),
    prepTimeMin:
      imported.prepTimeMin === null ? "" : String(imported.prepTimeMin),
    cookTimeMin:
      imported.cookTimeMin === null ? "" : String(imported.cookTimeMin),
    sourceUrl: imported.sourceUrl,
    photoPath: imported.photoPath,
    tags: imported.tags,
    sections: imported.sections.map((s) => ({
      uid: crypto.randomUUID(),
      title: s.title ?? "",
      instructions: s.instructions,
      ingredients:
        s.ingredients.length === 0
          ? [
              {
                uid: crypto.randomUUID(),
                name: "",
                quantity: "",
                unit: null,
                notes: "",
              },
            ]
          : s.ingredients.map<DraftIngredient>((i) => {
              // "synonym" and "matched" are both fine outcomes — collapse to "ok"
              // so the badge layer only highlights what needs attention.
              const unitState: ImportAnnotation["unitState"] =
                i.unitMatch === "matched" || i.unitMatch === "synonym"
                  ? "ok"
                  : i.unitMatch;
              const annotation: ImportAnnotation = {
                ingredientIsNew: i.ingredientMatch === "new",
                unitState,
                rawUnit: i.rawUnit,
              };
              return {
                uid: crypto.randomUUID(),
                name: i.name,
                quantity: i.quantity === null ? "" : String(i.quantity),
                unit: i.unit ? { id: i.unit.id, name: i.unit.name } : null,
                notes: i.notes ?? "",
                importAnnotation: annotation,
              };
            }),
    })),
  };
}

function ImportStats({ draft }: { draft: DraftRecipe }) {
  let total = 0;
  let unitUnknown = 0;
  let unitDefaulted = 0;
  let newIngredients = 0;
  for (const section of draft.sections) {
    for (const ing of section.ingredients) {
      total += 1;
      const a = ing.importAnnotation;
      if (!a) continue;
      if (a.unitState === "unresolved") unitUnknown += 1;
      if (a.unitState === "defaulted") unitDefaulted += 1;
      if (a.ingredientIsNew) newIngredients += 1;
    }
  }
  return (
    <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted)] p-4 text-sm">
      <p className="font-medium text-[var(--color-fg)]">
        {total} Zutat{total === 1 ? "" : "en"} importiert.
      </p>
      <ul className="mt-2 space-y-1 text-[var(--color-muted-fg)]">
        {newIngredients > 0 ? (
          <li className="inline-flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-[var(--color-warning)]" />
            {newIngredients} neue Zutat{newIngredients === 1 ? "" : "en"} – wird
            beim Speichern angelegt.
          </li>
        ) : null}
        {unitUnknown > 0 ? (
          <li className="inline-flex items-center gap-1.5">
            <AlertTriangle className="size-3.5 text-[var(--color-danger)]" />
            {unitUnknown} Einheit{unitUnknown === 1 ? "" : "en"} nicht erkannt –
            in der jeweiligen Zeile auswählen oder neu anlegen.
          </li>
        ) : null}
        {unitDefaulted > 0 ? (
          <li>
            {unitDefaulted}{" "}
            {unitDefaulted === 1 ? "Eintrag" : "Einträge"} ohne erkannte
            Einheit – Standard „Stück“.
          </li>
        ) : null}
        {newIngredients === 0 && unitUnknown === 0 && unitDefaulted === 0 ? (
          <li>Alles glatt zugeordnet. Bei Bedarf vor dem Speichern anpassen.</li>
        ) : null}
      </ul>
    </div>
  );
}

export function ImportFlow({ tagSuggestions }: Props) {
  const router = useRouter();
  const [url, setUrl] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<DraftRecipe | null>(null);
  const [mountKey, setMountKey] = React.useState(0);

  async function runImport() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/recipes/import-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setDraft(importedToDraft(data as ImportedRecipeResponse));
      setMountKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setDraft(null);
    setUrl("");
    setError(null);
  }

  if (draft) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--color-muted-fg)]">
            Importiert von{" "}
            <a
              href={draft.sourceUrl || url}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-[var(--color-fg)]"
            >
              {draft.sourceUrl || url}
            </a>
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={reset}>
            Andere URL importieren
          </Button>
        </div>
        <ImportStats draft={draft} />
        <RecipeForm
          key={mountKey}
          initial={draft}
          tagSuggestions={tagSuggestions}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] p-6">
        <div className="space-y-2">
          <Label htmlFor="import-url">Rezept-URL</Label>
          <div className="relative">
            <LinkIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted-fg)]" />
            <Input
              id="import-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (!loading && url.trim()) void runImport();
                }
              }}
              placeholder="https://…"
              autoFocus
              disabled={loading}
              className="pl-9"
            />
          </div>
          <p className="text-xs text-[var(--color-muted-fg)]">
            Funktioniert mit Seiten, die strukturierte Rezeptdaten (schema.org
            Recipe) liefern. Du siehst gleich eine Vorschau und kannst alles vor
            dem Speichern prüfen.
          </p>
          {error ? (
            <p className="rounded-[var(--radius)] border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger),var(--color-bg)_85%)] px-3 py-2 text-sm text-[var(--color-danger)]">
              {error}
            </p>
          ) : null}
        </div>
        <div className="mt-4 flex justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/rezepte/neu")}
          >
            Manuell erfassen
          </Button>
          <Button
            type="button"
            onClick={runImport}
            disabled={loading || url.trim().length === 0}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Importieren
          </Button>
        </div>
      </div>
    </div>
  );
}
