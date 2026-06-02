"use client";

import * as React from "react";

import { DialogShell } from "@/components/settings/stammdaten/dialog-shell";
import {
  IngredientForm,
  type IngredientItem,
} from "@/components/settings/stammdaten/edit-forms/ingredient-form";

type Props = {
  /** Article (ingredient) to edit. */
  ingredientId: number;
  onClose: () => void;
  /** Fired after a successful save with the updated article. */
  onSaved?: (updated: IngredientItem) => void;
};

/**
 * Opens the Stammdaten article editor (the same IngredientForm + DialogShell
 * the settings page uses) from anywhere — recipe edit, shopping list, staple
 * groups. Loads the article on open, saves via the shared manage endpoint.
 * Edit-only: deletion stays in the Stammdaten admin to keep its replacement
 * flow in one place.
 */
export function EditArticleDialog({ ingredientId, onClose, onSaved }: Props) {
  const [item, setItem] = React.useState<IngredientItem | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [payload, setPayload] = React.useState<unknown>(null);
  const [valid, setValid] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/ingredients/manage/${ingredientId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data: IngredientItem) => {
        if (!cancelled) setItem(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Artikel konnte nicht geladen werden.");
      });
    return () => {
      cancelled = true;
    };
  }, [ingredientId]);

  const handlePayloadChange = React.useCallback(
    (next: unknown, isValid: boolean) => {
      setPayload(next);
      setValid(isValid);
    },
    [],
  );

  async function save() {
    if (!valid || payload == null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/ingredients/manage/${ingredientId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const updated = (await res.json()) as IngredientItem;
      onSaved?.(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogShell
      open
      fillHeight
      onClose={onClose}
      title={item?.name ?? "Artikel bearbeiten"}
      mode="edit"
      onSave={save}
      saving={saving}
      saveDisabled={!valid || item == null}
      error={error ?? loadError}
    >
      {item ? (
        <IngredientForm item={item} onPayloadChange={handlePayloadChange} />
      ) : (
        <p className="text-sm text-[var(--color-muted-fg)]">
          {loadError ?? "lädt…"}
        </p>
      )}
    </DialogShell>
  );
}
