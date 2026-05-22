"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PlannerSettings } from "@/lib/settings/planner";

const WEEKDAY_NAMES: Array<{ value: number; label: string }> = [
  { value: 1, label: "Montag" },
  { value: 2, label: "Dienstag" },
  { value: 3, label: "Mittwoch" },
  { value: 4, label: "Donnerstag" },
  { value: 5, label: "Freitag" },
  { value: 6, label: "Samstag" },
  { value: 7, label: "Sonntag" },
];

export function PlannerSettingsForm({ initial }: { initial: PlannerSettings }) {
  const [daysVisible, setDaysVisible] = React.useState(initial.daysVisible);
  const [startWeekday, setStartWeekday] = React.useState(initial.startWeekday);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const dirty =
    daysVisible !== initial.daysVisible || startWeekday !== initial.startWeekday;

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/settings/planner", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ daysVisible, startWeekday }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage("Gespeichert.");
    } catch {
      setMessage("Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSave} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="daysVisible">Sichtbare Tage</Label>
        <Input
          id="daysVisible"
          type="number"
          min={1}
          max={28}
          value={daysVisible}
          onChange={(e) =>
            setDaysVisible(Math.max(1, Math.min(28, Number(e.target.value) || 1)))
          }
          className="w-32"
        />
        <p className="text-xs text-[var(--color-muted-fg)]">
          Anzahl aufeinanderfolgender Tage, die der Planer auf einer Seite zeigt
          (1–28).
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="startWeekday">Beginn der Woche</Label>
        <select
          id="startWeekday"
          value={startWeekday}
          onChange={(e) => setStartWeekday(Number(e.target.value))}
          className="h-11 w-48 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        >
          {WEEKDAY_NAMES.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-[var(--color-muted-fg)]">
          „Heute“ setzt den sichtbaren Bereich auf diesen Wochentag.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!dirty || saving}>
          {saving ? "Speichert…" : "Speichern"}
        </Button>
        {message ? (
          <span className="text-sm text-[var(--color-muted-fg)]">{message}</span>
        ) : null}
      </div>
    </form>
  );
}
