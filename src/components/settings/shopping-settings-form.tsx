"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ShoppingSettings } from "@/lib/shopping/settings";

export function ShoppingSettingsForm({ initial }: { initial: ShoppingSettings }) {
  const [defaultLengthDays, setDefaultLengthDays] = React.useState(
    initial.defaultLengthDays,
  );
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const dirty = defaultLengthDays !== initial.defaultLengthDays;

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/settings/shopping", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ defaultLengthDays }),
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
        <Label htmlFor="defaultLengthDays">Vorgabe-Länge (Tage)</Label>
        <Input
          id="defaultLengthDays"
          type="number"
          min={1}
          max={60}
          value={defaultLengthDays}
          onChange={(e) =>
            setDefaultLengthDays(
              Math.max(1, Math.min(60, Number(e.target.value) || 1)),
            )
          }
          className="w-32"
        />
        <p className="text-xs text-[var(--color-muted-fg)]">
          Vorgabe für den „Mahlzeiten hinzufügen“-Dialog (1–60).
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
