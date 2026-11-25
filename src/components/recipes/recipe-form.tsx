"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { NewIngredientsDialog } from "./new-ingredients-dialog";
import { PhotoUpload } from "./photo-upload";
import { SectionEditor } from "./section-editor";
import { moveAlternativeWithinGroup } from "./alternatives";
import { splitSectionAt } from "./split-section";
import { TagInput } from "./tag-input";
import { ReminderEditor } from "./reminder-editor";
import { hasReparsableRows, reparseAll } from "./reparse";
import {
  amountInputError,
  ingredientToPayload,
  rangeError,
  toNumberOrNull,
} from "./payload";
import { loadQuantifiers } from "./quantifier-list";
import { cn } from "@/lib/cn";
import {
  emptyRecipe,
  emptySection,
  type DraftIngredient,
  type DraftRecipe,
  type DraftSection,
} from "./types";
import { GripVertical } from "lucide-react";
import type { NewIngredientDefaults } from "@/lib/recipes/types";

type Props = {
  initial?: DraftRecipe;
  recipeId?: number;
  tagSuggestions: string[];
};

function buildPayload(draft: DraftRecipe) {
  return {
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    servings: Math.max(1, parseInt(draft.servings, 10) || 1),
    prepTimeMin: toNumberOrNull(draft.prepTimeMin),
    cookTimeMin: toNumberOrNull(draft.cookTimeMin),
    sourceUrl: draft.sourceUrl.trim() || null,
    importedFromUrl: draft.importedFromUrl?.trim() || null,
    photoPath: draft.photoPath,
    photoUrl: draft.photoUrl.trim() || null,
    tags: draft.tags,
    // Rows left without text carry nothing worth keeping — drop them.
    reminders: draft.reminders
      .map((r) => ({ daysBefore: r.daysBefore, hour: r.hour, text: r.text.trim() }))
      .filter((r) => r.text.length > 0),
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
  const [reparsingAll, setReparsingAll] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Pending submit waiting on the new-ingredients dialog. When set, the
  // dialog is open and `payload` is the validated draft to ship once the
  // user fills in (or skips) the per-name metadata.
  const [pendingSubmit, setPendingSubmit] = React.useState<{
    payload: ReturnType<typeof buildPayload>;
    newNames: string[];
  } | null>(null);

  function setSection(i: number, next: DraftSection) {
    const sections = draft.sections.slice();
    sections[i] = next;
    setDraft({ ...draft, sections });
  }

  const anyReparsable = draft.sections.some((s) =>
    hasReparsableRows(s.ingredients),
  );

  /** Re-parse every ingredient that has an original source line, across all
   *  sections — re-applies the current parser, discarding manual edits to
   *  those rows. Rows added by hand (no source line) are left as-is. */
  async function reparseWholeRecipe() {
    if (reparsingAll) return;
    setReparsingAll(true);
    try {
      const sections = await Promise.all(
        draft.sections.map(async (s) => ({
          ...s,
          ingredients: await reparseAll(s.ingredients),
        })),
      );
      setDraft({ ...draft, sections });
    } catch {
      setError("Neu-Parsen fehlgeschlagen.");
    } finally {
      setReparsingAll(false);
    }
  }

  function removeSection(i: number) {
    if (draft.sections.length === 1) return;
    // One tap removes the whole section — ask first when it holds anything.
    const s = draft.sections[i];
    const hasContent =
      s.instructions.trim().length > 0 ||
      s.ingredients.some((ing) => ing.name.trim() || ing.quantity.trim());
    if (
      hasContent &&
      !window.confirm(
        `Abschnitt ${s.title.trim() ? `„${s.title.trim()}“` : i + 1} mit allen Zutaten und der Zubereitung entfernen?`,
      )
    ) {
      return;
    }
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

  // Pending uid of a freshly-added section to scroll into view once the
  // SectionEditor for it has mounted. Cleared by the effect below.
  const [scrollToSectionUid, setScrollToSectionUid] = React.useState<string | null>(
    null,
  );
  React.useEffect(() => {
    if (!scrollToSectionUid) return;
    const node = document.getElementById(`section-title-${scrollToSectionUid}`);
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      const input = node as HTMLInputElement;
      if (typeof input.focus === "function") input.focus();
    }
    // Consume the trigger so a re-render doesn't scroll again.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScrollToSectionUid(null);
  }, [scrollToSectionUid]);

  function addSection() {
    const fresh = emptySection();
    setDraft({ ...draft, sections: [...draft.sections, fresh] });
    setScrollToSectionUid(fresh.uid);
  }

  /** Split section `i` before flat ingredient index `at` — the rows from
   *  there down move into a fresh section inserted right after it, whose
   *  title input then scrolls into view for naming. */
  function splitSection(i: number, at: number) {
    const result = splitSectionAt(draft.sections, i, at);
    if (!result) return;
    setDraft({ ...draft, sections: result.sections });
    setScrollToSectionUid(result.newSectionUid);
  }

  function appendSectionsAfter(i: number, extras: DraftSection[]) {
    if (extras.length === 0) return;
    const sections = draft.sections.slice();
    sections.splice(i + 1, 0, ...extras);
    setDraft({ ...draft, sections });
  }

  const sensors = useSensors(
    // Small activation distance keeps a tap on the grip's neighbouring inputs
    // from being interpreted as the start of a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function findIngredient(
    uid: string,
  ): { sectionIdx: number; ingredientIdx: number } | null {
    for (let s = 0; s < draft.sections.length; s++) {
      const i = draft.sections[s].ingredients.findIndex((ing) => ing.uid === uid);
      if (i >= 0) return { sectionIdx: s, ingredientIdx: i };
    }
    return null;
  }

  /**
   * Return the [start, end] inclusive bounds of the alternative group
   * containing `idx`. Walks up to the row's primary then down through any
   * trailing alternatives. A row with no alternatives returns [idx, idx].
   */
  function groupBounds(
    ingredients: DraftIngredient[],
    idx: number,
  ): [number, number] {
    let start = idx;
    while (start > 0 && ingredients[start].isAlternative) start -= 1;
    let end = start;
    while (
      end + 1 < ingredients.length &&
      ingredients[end + 1].isAlternative
    )
      end += 1;
    return [start, end];
  }

  // Currently-dragged ingredient, rendered in the DragOverlay so the user
  // always sees what's being dragged — including when the cursor crosses
  // into a different section's SortableContext where the source list's
  // in-place placeholder isn't visible.
  const [activeIngredient, setActiveIngredient] = React.useState<DraftIngredient | null>(
    null,
  );

  function onIngredientDragStart(event: DragStartEvent) {
    const source = findIngredient(String(event.active.id));
    if (!source) return;
    setActiveIngredient(draft.sections[source.sectionIdx].ingredients[source.ingredientIdx]);
  }

  function onIngredientDragCancel() {
    setActiveIngredient(null);
  }

  function onIngredientDragEnd(event: DragEndEvent) {
    setActiveIngredient(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const source = findIngredient(activeId);
    if (!source) return;
    const sourceIngredients = draft.sections[source.sectionIdx].ingredients;

    // An alternative drag reorders WITHIN its own group only — never moves a
    // group or crosses sections. The helper clamps the target to the group,
    // so a drop outside it is a harmless no-op.
    if (sourceIngredients[source.ingredientIdx].isAlternative) {
      const target = findIngredient(overId);
      if (!target || target.sectionIdx !== source.sectionIdx) return;
      const reordered = moveAlternativeWithinGroup(
        sourceIngredients,
        source.ingredientIdx,
        target.ingredientIdx,
      );
      setDraft({
        ...draft,
        sections: draft.sections.map((s, idx) =>
          idx === source.sectionIdx ? { ...s, ingredients: reordered } : s,
        ),
      });
      return;
    }

    const [sourceGroupStart, sourceGroupEnd] = groupBounds(
      sourceIngredients,
      source.ingredientIdx,
    );

    // The drop target is either a section (empty/end-of-list drop) or an
    // ingredient. If it's an alternative, snap to its primary's index so
    // the drop lands at the group boundary, never INSIDE another group.
    const sectionAsTarget = draft.sections.findIndex((s) => s.uid === overId);
    let targetSectionIdx: number;
    let insertionIdx: number;
    if (sectionAsTarget >= 0) {
      targetSectionIdx = sectionAsTarget;
      insertionIdx = draft.sections[sectionAsTarget].ingredients.length;
    } else {
      const target = findIngredient(overId);
      if (!target) return;
      targetSectionIdx = target.sectionIdx;
      const [targetGroupStart] = groupBounds(
        draft.sections[targetSectionIdx].ingredients,
        target.ingredientIdx,
      );
      insertionIdx = targetGroupStart;
    }

    // No-op when the group is already at the target position.
    if (
      source.sectionIdx === targetSectionIdx &&
      insertionIdx >= sourceGroupStart &&
      insertionIdx <= sourceGroupEnd + 1
    ) {
      return;
    }

    const next = draft.sections.map((s) => ({
      ...s,
      ingredients: s.ingredients.slice(),
    }));
    const groupSize = sourceGroupEnd - sourceGroupStart + 1;
    const movingGroup = next[source.sectionIdx].ingredients.splice(
      sourceGroupStart,
      groupSize,
    );
    // After splicing OUT of the source, shift the insertion index when the
    // target is in the same section and lies AFTER the removed slice.
    if (
      source.sectionIdx === targetSectionIdx &&
      insertionIdx > sourceGroupStart
    ) {
      insertionIdx -= groupSize;
    }
    next[targetSectionIdx].ingredients.splice(insertionIdx, 0, ...movingGroup);

    setDraft({ ...draft, sections: next });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!draft.title.trim()) {
      setError("Titel ist erforderlich.");
      return;
    }
    const hasRangeError = draft.sections.some((s) =>
      s.ingredients.some((ing) => rangeError(ing)),
    );
    if (hasRangeError) {
      setError(
        "Ein Mengenbereich ist ungültig: Die Untergrenze muss kleiner als die Obergrenze sein.",
      );
      return;
    }
    // The amount field accepts a number OR a known quantifier word; block save
    // if any row's amount text is neither (mirrors the range-error gate above).
    // Load the quantifier list once here so we resolve against the same data
    // the rows do.
    const quantifiers = await loadQuantifiers();
    const hasAmountError = draft.sections.some((s) =>
      s.ingredients.some((ing) => amountInputError(ing, quantifiers)),
    );
    if (hasAmountError) {
      setError(
        "Eine Menge ist ungültig: Bitte eine Zahl oder einen bekannten Mengenbezeichner (z. B. „einige“, „zwei“) eingeben.",
      );
      return;
    }
    const payload = buildPayload(draft);
    if (payload.sections.every((s) => s.ingredients.length === 0)) {
      setError("Mindestens eine Zutat erfassen.");
      return;
    }

    setSaving(true);
    try {
      // Ask the server which submitted ingredient names would be auto-
      // created. If any, hand off to the dialog so the user can fill in
      // category / diet / exclude in one step before the recipe POST runs.
      //
      // Only check rows WITHOUT a pre-resolved ingredientId. Rows with an
      // explicit ingredientId (set by the pill UI's auto-select or the
      // user picking a candidate) are pinned to an existing canonical
      // already — the server's resolveIngredient won't run name-based
      // lookup for them, so they can't surprise-create a new ingredient
      // ("Zwiebeln" → linked to canonical "Zwiebel", false positive).
      const allNames = Array.from(
        new Set(
          payload.sections.flatMap((s) =>
            s.ingredients
              // Unassigned rows never become articles, so they don't need the
              // "neue Zutaten" metadata dialog either.
              .filter((i) => i.ingredientId == null && !i.unassigned)
              .map((i) => i.ingredientName.trim()),
          ),
        ),
      );
      const checkRes = await fetch("/api/v1/ingredients/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ names: allNames }),
      });
      const checkData = checkRes.ok
        ? ((await checkRes.json()) as { newNames: string[] })
        : { newNames: [] };
      if (checkData.newNames.length > 0) {
        setPendingSubmit({ payload, newNames: checkData.newNames });
        setSaving(false);
        return;
      }
      await postRecipe(payload, undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  async function postRecipe(
    payload: ReturnType<typeof buildPayload>,
    newIngredientDefaults: NewIngredientDefaults[] | undefined,
  ) {
    const url = recipeId ? `/api/v1/recipes/${recipeId}` : "/api/v1/recipes";
    const method = recipeId ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...payload,
        ...(newIngredientDefaults && newIngredientDefaults.length > 0
          ? { newIngredientDefaults }
          : {}),
      }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { id?: number };
    const targetId = recipeId ?? data.id;
    router.push(targetId ? `/rezepte/${targetId}` : "/rezepte");
    router.refresh();
  }

  async function onConfirmNewIngredients(
    defaults: NewIngredientDefaults[],
  ) {
    if (!pendingSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await postRecipe(pendingSubmit.payload, defaults);
      setPendingSubmit(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
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
    <form
      onSubmit={onSubmit}
      onKeyDown={onFormKeyDown}
      className="space-y-4 md:space-y-6"
    >
      <FormCard title="Grunddaten">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label htmlFor="title">Titel</Label>
            <Input
              id="title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              required
              enterKeyHint="next"
              className="mt-1.5"
            />
          </div>
          {/* Portionen + times: three short numeric fields side by side even
              on a phone, so they don't each eat a full-width row. */}
          <div className="grid grid-cols-3 gap-2 sm:gap-4 md:col-span-2">
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
              <Label htmlFor="prepTime">
                Vorb.<span className="hidden sm:inline">ereitung</span>{" "}
                <span className="font-normal text-[var(--color-muted-fg)]">(Min.)</span>
              </Label>
              <Input
                id="prepTime"
                inputMode="numeric"
                value={draft.prepTimeMin}
                onChange={(e) => setDraft({ ...draft, prepTimeMin: e.target.value })}
                placeholder="–"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="cookTime">
                Kochzeit{" "}
                <span className="font-normal text-[var(--color-muted-fg)]">(Min.)</span>
              </Label>
              <Input
                id="cookTime"
                inputMode="numeric"
                value={draft.cookTimeMin}
                onChange={(e) => setDraft({ ...draft, cookTimeMin: e.target.value })}
                placeholder="–"
                className="mt-1.5"
              />
            </div>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="sourceUrl">
              Quelle{" "}
              <span className="font-normal text-[var(--color-muted-fg)]">(optional)</span>
            </Label>
            <Input
              id="sourceUrl"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              value={draft.sourceUrl}
              onChange={(e) => setDraft({ ...draft, sourceUrl: e.target.value })}
              className="mt-1.5"
              placeholder="https://…"
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="description">
              Beschreibung{" "}
              <span className="font-normal text-[var(--color-muted-fg)]">(optional)</span>
            </Label>
            <MarkdownEditor
              id="description"
              value={draft.description}
              onChange={(description) => setDraft({ ...draft, description })}
              rows={3}
              className="mt-1.5"
            />
          </div>
        </div>
      </FormCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
        <FormCard title="Foto">
          <PhotoUpload
            photoPath={draft.photoPath}
            onPhotoPathChange={(photoPath) => setDraft({ ...draft, photoPath })}
            photoUrl={draft.photoUrl}
            onPhotoUrlChange={(photoUrl) => setDraft({ ...draft, photoUrl })}
          />
        </FormCard>
        <FormCard title="Tags">
          <TagInput
            value={draft.tags}
            onChange={(tags) => setDraft({ ...draft, tags })}
            suggestions={tagSuggestions}
          />
        </FormCard>
      </div>

      <FormCard
        title="Erinnerungen"
        description="Vorbereitung relativ zum geplanten Tag — erscheint im Essensplan, auf dem Dashboard und in Home Assistant."
      >
        <ReminderEditor
          value={draft.reminders}
          onChange={(reminders) => setDraft({ ...draft, reminders })}
        />
      </FormCard>

      <div className="space-y-3 md:space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <h2 className="text-lg font-semibold text-[var(--color-fg)]">
            Zutaten &amp; Zubereitung
          </h2>
          {anyReparsable ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={reparseWholeRecipe}
              disabled={reparsingAll}
              title="Alle Zutaten aus ihren Originalzeilen neu parsen (verwirft manuelle Änderungen)"
            >
              <RefreshCw
                className={cn("size-4", reparsingAll && "animate-spin")}
              />
              Alle neu parsen
            </Button>
          ) : null}
        </div>
        <DndContext
          // Stable `id` keeps @dnd-kit's internal `DndDescribedBy-{n}` ARIA
          // id deterministic across SSR/CSR. Without it the module-level
          // counter advances differently in dev (StrictMode double-mount)
          // and triggers a hydration mismatch on every draggable handle.
          id="recipe-ingredients-dnd"
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onIngredientDragStart}
          onDragEnd={onIngredientDragEnd}
          onDragCancel={onIngredientDragCancel}
        >
          {draft.sections.map((section, i) => (
            <SectionEditor
              key={section.uid}
              section={section}
              index={i}
              total={draft.sections.length}
              onChange={(next) => setSection(i, next)}
              onRemove={() => removeSection(i)}
              onMove={(dir) => moveSection(i, dir)}
              onAppendSections={(extras) => appendSectionsAfter(i, extras)}
              onSplit={(at) => splitSection(i, at)}
            />
          ))}
          <DragOverlay dropAnimation={null}>
            {activeIngredient ? (
              <IngredientDragPreview ingredient={activeIngredient} />
            ) : null}
          </DragOverlay>
        </DndContext>
        <Button
          type="button"
          variant="outline"
          onClick={addSection}
          className="w-full border-dashed"
        >
          <Plus className="size-4" />
          Abschnitt hinzufügen
          <span className="hidden font-normal text-[var(--color-muted-fg)] sm:inline">
            (z. B. Teig, Füllung, Soße)
          </span>
        </Button>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-[var(--radius)] border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger),var(--color-bg)_85%)] px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      <NewIngredientsDialog
        open={pendingSubmit != null}
        newNames={pendingSubmit?.newNames ?? []}
        saving={saving}
        onCancel={() => {
          setPendingSubmit(null);
          setSaving(false);
        }}
        onConfirm={onConfirmNewIngredients}
      />

      {/* Action bar. Sticky so saving never needs a scroll to the end of a
          long recipe — on phones it rides just above the bottom nav (h-16 +
          safe area), on desktop at the viewport's bottom edge. */}
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex items-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-bg)]/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-bg)]/80 md:bottom-0 md:-mx-6 md:justify-end md:px-6">
        {recipeId ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onDelete}
            disabled={saving}
            aria-label="Rezept löschen"
            title="Rezept löschen"
            className="shrink-0 text-[var(--color-danger)] max-md:w-11 max-md:px-0"
          >
            <Trash2 className="size-4" />
            <span className="hidden md:inline">Rezept löschen</span>
          </Button>
        ) : null}
        <Button type="submit" disabled={saving} className="flex-1 md:flex-none">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {recipeId ? "Änderungen speichern" : "Rezept anlegen"}
        </Button>
      </div>
    </form>
  );
}

/** One titled card of the form — keeps the long form scannable on a phone. */
function FormCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] p-3 sm:p-4 md:p-6">
      <h2 className="text-base font-semibold text-[var(--color-fg)]">{title}</h2>
      {description ? (
        <p className="mt-0.5 text-xs text-[var(--color-muted-fg)]">{description}</p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Compact preview rendered inside the DragOverlay so the dragged ingredient
 * stays visible while the cursor is over a different section's SortableContext
 * (which doesn't surface an in-place placeholder for items it doesn't own).
 */
function IngredientDragPreview({ ingredient }: { ingredient: DraftIngredient }) {
  const unit = ingredient.unit?.name ?? "";
  const quantity = ingredient.quantity.trim();
  const lead = [quantity, unit].filter(Boolean).join(" ");
  const name = ingredient.name.trim() || ingredient.canonicalName || "Zutat";
  return (
    <div className="flex cursor-grabbing items-center gap-2 rounded-md border border-[var(--color-accent)] bg-[var(--color-card)] px-2 py-1.5 text-sm shadow-xl">
      <GripVertical className="size-4 text-[var(--color-muted-fg)]" />
      {lead ? (
        <span className="text-[var(--color-muted-fg)] tabular-nums">{lead}</span>
      ) : null}
      <span className="truncate font-medium">{name}</span>
    </div>
  );
}
