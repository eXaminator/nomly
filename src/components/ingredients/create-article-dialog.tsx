"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SelectSearch,
  type SelectSearchItem,
} from "@/components/ui/select-search";
import { Switch } from "@/components/ui/switch";
import {
  AdvancedArticleFields,
  advancedStateToPayload,
  emptyAdvancedArticleState,
  type AdvancedArticleState,
} from "@/components/ingredients/article-fields/advanced-article-fields";

export type CreatedArticle = {
  id: number;
  name: string;
  defaultCategoryId: number | null;
  defaultCategoryName: string | null;
};

type Props = {
  open: boolean;
  initialName: string;
  onClose: () => void;
  onCreated: (article: CreatedArticle) => void;
};

async function searchCategories(q: string): Promise<SelectSearchItem[]> {
  const res = await fetch(`/api/v1/categories?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  const body = (await res.json()) as {
    items: Array<{ id: number; name: string }>;
  };
  return body.items;
}

type DietValue = "vegan" | "vegetarian" | "meat" | null;
const DIET_OPTIONS: Array<{ value: DietValue; label: string }> = [
  { value: null, label: "Unbekannt" },
  { value: "vegan", label: "Vegan" },
  { value: "vegetarian", label: "Vegetarisch" },
  { value: "meat", label: "Tierisch" },
];

export function CreateArticleDialog({
  open,
  initialName,
  onClose,
  onCreated,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        {open ? (
          <Body
            key={initialName}
            initialName={initialName}
            onClose={onClose}
            onCreated={onCreated}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  initialName,
  onClose,
  onCreated,
}: {
  initialName: string;
  onClose: () => void;
  onCreated: (a: CreatedArticle) => void;
}) {
  const [name, setName] = React.useState(initialName);
  const [category, setCategory] = React.useState<SelectSearchItem | null>(null);
  const [diet, setDiet] = React.useState<DietValue>(null);
  const [isEquipment, setIsEquipment] = React.useState(false);
  const [excludeFromShoppingList, setExclude] = React.useState(false);
  const [advanced, setAdvanced] = React.useState<AdvancedArticleState>(
    emptyAdvancedArticleState,
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Name darf nicht leer sein.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/ingredients/manage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          defaultCategoryId: category?.id ?? null,
          excludeFromShoppingList,
          isEquipment,
          dietaryClass: diet,
          ...advancedStateToPayload(advanced),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        if (body.error === "duplicate" || body.error === "duplicate_name") {
          setError("Es gibt schon einen Artikel mit diesem Namen.");
          return;
        }
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      const created = (await res.json()) as {
        id: number;
        name: string;
        defaultCategoryId: number | null;
        defaultCategoryName: string | null;
      };
      onCreated({
        id: created.id,
        name: created.name,
        defaultCategoryId: created.defaultCategoryId,
        defaultCategoryName: created.defaultCategoryName,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Neuer Artikel</DialogTitle>
        <DialogDescription>
          Lege den Artikel an. Aliase und Unter-Einheiten kannst du später
          in den Einstellungen ergänzen.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="create-article-name">Name</Label>
          <Input
            id="create-article-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Kategorie</Label>
          <SelectSearch
            value={category}
            onChange={setCategory}
            search={searchCategories}
            placeholder="Kategorie auswählen…"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Diät</Label>
          <div className="flex flex-wrap gap-2">
            {DIET_OPTIONS.map((opt) => {
              const active = diet === opt.value;
              return (
                <button
                  type="button"
                  key={opt.label}
                  onClick={() => setDiet(opt.value)}
                  className={
                    "rounded-[var(--radius)] border px-3 py-1.5 text-sm " +
                    (active
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-fg)]"
                      : "border-[var(--color-border)] text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]")
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2">
          <span>
            <span className="block text-sm font-medium">Ausrüstung</span>
            <span className="block text-xs text-[var(--color-muted-fg)]">
              Backpapier, Backform, Frischhaltefolie — meist auf Vorrat.
            </span>
          </span>
          <Switch checked={isEquipment} onCheckedChange={setIsEquipment} />
        </label>
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2">
          <span>
            <span className="block text-sm font-medium">
              Von Einkaufsliste ausschließen
            </span>
            <span className="block text-xs text-[var(--color-muted-fg)]">
              Wasser, Salz — immer vorhanden, soll nie auf der Liste landen.
            </span>
          </span>
          <Switch
            checked={excludeFromShoppingList}
            onCheckedChange={setExclude}
          />
        </label>
        {error ? (
          <p className="text-sm text-[var(--color-danger)]">{error}</p>
        ) : null}
        {/* Glue the advanced section to the dialog body's bottom edge: bleed
            past the body's px-6/pb-4 and match that padding back inside. */}
        <div className="-mx-6 -mb-4">
          <AdvancedArticleFields
            name={name}
            value={advanced}
            onChange={setAdvanced}
            paddingXClassName="px-6"
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Abbrechen
        </Button>
        <Button onClick={submit} disabled={saving || name.trim().length === 0}>
          {saving ? "Speichert…" : "Anlegen"}
        </Button>
      </DialogFooter>
    </>
  );
}
