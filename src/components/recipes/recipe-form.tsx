"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PhotoUpload } from "./photo-upload";
import { SectionEditor } from "./section-editor";
import { TagInput } from "./tag-input";
import {
  emptyRecipe,
  emptySection,
  type DraftIngredient,
  type DraftRecipe,
  type DraftSection,
} from "./types";

type Props = {
  initial?: DraftRecipe;
  recipeId?: number;
  tagSuggestions: string[];
};

function toNumberOrNull(raw: string): number | null {
  const v = raw.trim();
  if (v.length === 0) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function ingredientToPayload(ing: DraftIngredient) {
  const name = ing.name.trim();
  if (name.length === 0) return null;
  return {
    ingredientName: name,
    quantity: toNumberOrNull(ing.quantity),
    unitId: ing.unit?.id ?? null,
    notes: ing.notes.trim() || null,
  };
}

function buildPayload(draft: DraftRecipe) {
  return {
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    servings: Math.max(1, parseInt(draft.servings, 10) || 1),
    prepTimeMin: toNumberOrNull(draft.prepTimeMin),
    cookTimeMin: toNumberOrNull(draft.cookTimeMin),
    sourceUrl: draft.sourceUrl.trim() || null,
    photoPath: draft.photoPath,
    tags: draft.tags,
    sections: draft.sections.map((s) => ({
      title: s.title.trim() || null,
      instructions: s.instructions,
      ingredients: s.ingredients
        .map(ingredientToPayload)
        .filter((i): i is NonNullable<ReturnType<typeof ingredientToPayload>> => i !== null),
    })),
  };
}

export function RecipeForm({ initial, recipeId, tagSuggestions }: Props) {
  const router = useRouter();
  const [draft, setDraft] = React.useState<DraftRecipe>(initial ?? emptyRecipe());
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function setSection(i: number, next: DraftSection) {
    const sections = draft.sections.slice();
    sections[i] = next;
    setDraft({ ...draft, sections });
  }

  function removeSection(i: number) {
    if (draft.sections.length === 1) return;
    const sections = draft.sections.slice();
    sections.splice(i, 1);
    setDraft({ ...draft, sections });
  }

  function moveSection(i: number, direction: -1 | 1) {
    const j = i + direction;
    if (j < 0 || j >= draft.sections.length) return;
    const sections = draft.sections.slice();
    [sections[i], sections[j]] = [sections[j], sections[i]];
    setDraft({ ...draft, sections });
  }

  function addSection() {
    setDraft({ ...draft, sections: [...draft.sections, emptySection()] });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!draft.title.trim()) {
      setError("Titel ist erforderlich.");
      return;
    }
    const payload = buildPayload(draft);
    if (payload.sections.every((s) => s.ingredients.length === 0)) {
      setError("Mindestens eine Zutat erfassen.");
      return;
    }

    setSaving(true);
    try {
      const url = recipeId ? `/api/v1/recipes/${recipeId}` : "/api/v1/recipes";
      const method = recipeId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { id?: number };
      const targetId = recipeId ?? data.id;
      router.push(targetId ? `/rezepte/${targetId}` : "/rezepte");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!recipeId) return;
    if (!window.confirm("Rezept löschen? Diese Aktion kann nicht rückgängig gemacht werden.")) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/recipes/${recipeId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.push("/rezepte");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Löschen fehlgeschlagen.");
      setSaving(false);
    }
  }

  // Enter on a text input would otherwise trigger implicit form submission.
  // We only want the explicit "Rezept anlegen" button to submit, so swallow
  // Enter for everything except <textarea> and the submit button itself.
  function onFormKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key !== "Enter") return;
    const t = e.target as HTMLElement;
    if (t.tagName === "TEXTAREA") return;
    if (t instanceof HTMLButtonElement && t.type === "submit") return;
    e.preventDefault();
  }

  return (
    <form onSubmit={onSubmit} onKeyDown={onFormKeyDown} className="space-y-6">
      <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 md:p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label htmlFor="title">Titel</Label>
            <Input
              id="title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              required
              className="mt-1.5"
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="description">Beschreibung (Markdown, optional)</Label>
            <Textarea
              id="description"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={3}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="servings">Portionen</Label>
            <Input
              id="servings"
              inputMode="numeric"
              value={draft.servings}
              onChange={(e) => setDraft({ ...draft, servings: e.target.value })}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="sourceUrl">Quelle (URL, optional)</Label>
            <Input
              id="sourceUrl"
              type="url"
              value={draft.sourceUrl}
              onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })}
              className="mt-1.5"
              placeholder="https://…"
            />
          </div>
          <div>
            <Label htmlFor="prepTime">Vorbereitungszeit (Min., optional)</Label>
            <Input
              id="prepTime"
              inputMode="numeric"
              value={draft.prepTimeMin}
              onChange={(e) => setDraft({ ...draft, prepTimeMin: e.target.value })}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="cookTime">Kochzeit (Min., optional)</Label>
            <Input
              id="cookTime"
              inputMode="numeric"
              value={draft.cookTimeMin}
              onChange={(e) => setDraft({ ...draft, cookTimeMin: e.target.value })}
              className="mt-1.5"
            />
          </div>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <Label>Foto</Label>
            <div className="mt-1.5">
              <PhotoUpload
                value={draft.photoPath}
                onChange={(photoPath) => setDraft({ ...draft, photoPath })}
              />
            </div>
          </div>
          <div>
            <Label>Tags</Label>
            <div className="mt-1.5">
              <TagInput
                value={draft.tags}
                onChange={(tags) => setDraft({ ...draft, tags })}
                suggestions={tagSuggestions}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">Abschnitte</h2>
          <Button type="button" variant="outline" size="sm" onClick={addSection}>
            <Plus className="size-4" />
            Abschnitt hinzufügen
          </Button>
        </div>
        {draft.sections.map((section, i) => (
          <SectionEditor
            key={section.uid}
            section={section}
            index={i}
            total={draft.sections.length}
            onChange={(next) => setSection(i, next)}
            onRemove={() => removeSection(i)}
            onMove={(dir) => moveSection(i, dir)}
          />
        ))}
      </div>

      {error ? (
        <p className="rounded-[var(--radius)] border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger),var(--color-bg)_85%)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {recipeId ? (
          <Button
            type="button"
            variant="danger"
            onClick={onDelete}
            disabled={saving}
          >
            <Trash2 className="size-4" />
            Rezept löschen
          </Button>
        ) : null}
        <Button
          type="submit"
          disabled={saving}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {recipeId ? "Änderungen speichern" : "Rezept anlegen"}
        </Button>
      </div>
    </form>
  );
}
