"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ClipboardPaste,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { Textarea } from "@/components/ui/textarea";
import { IngredientRow } from "./ingredient-row";
import {
  emptyIngredient,
  parsedIngredientToDraft,
  type DraftIngredient,
  type DraftSection,
  type ParsedIngredientResponse,
} from "./types";

/**
 * Read the clipboard with a short timeout so a hanging permission prompt
 * (Firefox / Safari / http://localhost in some browsers) doesn't lock the
 * dialog. Returns null on any failure — the textarea acts as a manual
 * fallback either way.
 */
async function tryReadClipboard(timeoutMs = 800): Promise<string | null> {
  if (!navigator.clipboard?.readText) return null;
  try {
    const text = await Promise.race([
      navigator.clipboard.readText(),
      new Promise<null>((resolve) =>
        window.setTimeout(() => resolve(null), timeoutMs),
      ),
    ]);
    return typeof text === "string" && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

type Props = {
  section: DraftSection;
  index: number;
  total: number;
  onChange: (next: DraftSection) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
};

/**
 * A draft row counts as "blank" when it has no name and no quantity — i.e.
 * the placeholder row the section starts with. Paste should replace those
 * rather than appending below them so the user doesn't end up with an empty
 * row above the freshly-parsed entries.
 */
function isBlankDraft(d: DraftIngredient): boolean {
  return d.name.trim().length === 0 && d.quantity.trim().length === 0;
}

export function SectionEditor({
  section,
  index,
  total,
  onChange,
  onRemove,
  onMove,
}: Props) {
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasteText, setPasteText] = React.useState("");
  const [pasting, setPasting] = React.useState(false);
  const [pasteError, setPasteError] = React.useState<string | null>(null);
  const [pasteInfo, setPasteInfo] = React.useState<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  function setIngredient(i: number, next: DraftIngredient) {
    const ings = section.ingredients.slice();
    ings[i] = next;
    onChange({ ...section, ingredients: ings });
  }

  function removeIngredient(i: number) {
    const ings = section.ingredients.slice();
    ings.splice(i, 1);
    onChange({ ...section, ingredients: ings });
  }

  function addIngredient() {
    onChange({
      ...section,
      ingredients: [...section.ingredients, emptyIngredient()],
    });
  }

  async function openPasteDialog() {
    setPasteError(null);
    setPasteInfo(null);
    setPasteText("");
    setPasteOpen(true);
    // Best-effort: try to pre-fill from the clipboard so the common case
    // works in one click. The user can paste / edit manually otherwise.
    const text = await tryReadClipboard();
    if (text) {
      setPasteText(text);
    } else {
      // Hand the focus to the textarea so Ctrl/Cmd+V works directly.
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  async function submitPaste() {
    setPasteError(null);
    setPasteInfo(null);
    const text = pasteText.trim();
    if (text.length === 0) {
      setPasteError("Bitte Text einfügen.");
      return;
    }
    setPasting(true);
    try {
      const res = await fetch("/api/v1/ingredients/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { items: ParsedIngredientResponse[] };
      if (data.items.length === 0) {
        setPasteError("Konnte keine Zutaten erkennen.");
        return;
      }
      const drafts = data.items.map(parsedIngredientToDraft);
      // Replace the initial blank placeholder row(s); otherwise append.
      const keep = section.ingredients.filter((i) => !isBlankDraft(i));
      onChange({ ...section, ingredients: [...keep, ...drafts] });
      setPasteOpen(false);
      setPasteInfo(
        `${drafts.length} Zutat${drafts.length === 1 ? "" : "en"} eingefügt.`,
      );
      window.setTimeout(() => setPasteInfo(null), 3000);
    } catch (e) {
      setPasteError(
        e instanceof Error ? e.message : "Einfügen fehlgeschlagen.",
      );
    } finally {
      setPasting(false);
    }
  }

  return (
    <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 md:p-6">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <Label htmlFor={`section-title-${section.uid}`} className="sr-only">
            Abschnittstitel
          </Label>
          <Input
            id={`section-title-${section.uid}`}
            placeholder={`Abschnitt ${index + 1} (optional, z. B. „Teig")`}
            value={section.title}
            onChange={(e) => onChange({ ...section, title: e.target.value })}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label="Nach oben"
        >
          <ArrowUp className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          aria-label="Nach unten"
        >
          <ArrowDown className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={total === 1}
          aria-label="Abschnitt entfernen"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        <Label htmlFor={`section-ingredients-${section.uid}`}>Zutaten</Label>
        <div id={`section-ingredients-${section.uid}`} className="space-y-2">
          {section.ingredients.map((ing, i) => (
            <IngredientRow
              key={ing.uid}
              value={ing}
              onChange={(next) => setIngredient(i, next)}
              onRemove={() => removeIngredient(i)}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addIngredient}
          >
            <Plus className="size-4" />
            Zutat hinzufügen
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={openPasteDialog}
            title="Öffnet ein Eingabefeld — Text einfügen, dann parsen."
          >
            <ClipboardPaste className="size-4" />
            Aus Zwischenablage einfügen
          </Button>
          {pasteInfo ? (
            <span className="text-xs text-[var(--color-success)]">
              {pasteInfo}
            </span>
          ) : null}
        </div>
      </div>

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Zutaten aus Text einfügen</DialogTitle>
            <DialogDescription>
              Eine Zutat pro Zeile. HTML-Tabellen aus Rezeptseiten
              (Chefkoch &amp; Co.) werden ebenfalls erkannt — Menge und Name
              auf separaten Zeilen werden zusammengefügt.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            ref={textareaRef}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={10}
            placeholder={"500 g Mehl\n2 Eier\nSalz"}
            autoFocus
          />
          {pasteError ? (
            <p className="text-sm text-[var(--color-danger)]">{pasteError}</p>
          ) : null}
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pasting}>
                Abbrechen
              </Button>
            </DialogClose>
            <Button
              type="button"
              onClick={submitPaste}
              disabled={pasting || pasteText.trim().length === 0}
            >
              {pasting ? <Loader2 className="size-4 animate-spin" /> : null}
              Parsen &amp; Einfügen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mt-4">
        <Label htmlFor={`section-instructions-${section.uid}`}>
          Anleitung (Markdown)
        </Label>
        <MarkdownEditor
          id={`section-instructions-${section.uid}`}
          rows={8}
          placeholder="1. ..."
          value={section.instructions}
          onChange={(instructions) => onChange({ ...section, instructions })}
          className="mt-1.5"
        />
      </div>
    </div>
  );
}
