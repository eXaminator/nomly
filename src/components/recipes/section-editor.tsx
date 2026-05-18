"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { IngredientRow } from "./ingredient-row";
import {
  emptyIngredient,
  type DraftIngredient,
  type DraftSection,
} from "./types";

type Props = {
  section: DraftSection;
  index: number;
  total: number;
  onChange: (next: DraftSection) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
};

export function SectionEditor({
  section,
  index,
  total,
  onChange,
  onRemove,
  onMove,
}: Props) {
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addIngredient}
        >
          <Plus className="size-4" />
          Zutat hinzufügen
        </Button>
      </div>

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
