"use client";

import * as React from "react";
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";

const COLOR_PRESETS = [
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#ef4444", // red
  "#f59e0b", // amber
  "#10b981", // emerald
  "#14b8a6", // teal
  "#64748b", // slate
];

type Feed = {
  id: number;
  name: string;
  url: string;
  color: string;
};

type Props =
  | {
      mode: "create";
      onClose: () => void;
      onSaved: () => void;
    }
  | {
      mode: "edit";
      feed: Feed;
      onClose: () => void;
      onSaved: () => void;
    };

export function CalendarFeedDialog(props: Props) {
  const initial = props.mode === "edit" ? props.feed : null;
  const [name, setName] = React.useState(initial?.name ?? "");
  const [url, setUrl] = React.useState(initial?.url ?? "");
  const [color, setColor] = React.useState(initial?.color ?? COLOR_PRESETS[0]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && url.trim().length > 0;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      let res: Response;
      let createdId: number | null = null;
      if (props.mode === "create") {
        res = await fetch("/api/v1/ical-feeds", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: name.trim(), url: url.trim(), color }),
        });
        if (res.ok) {
          const created = (await res.json()) as { id: number };
          createdId = created.id;
        }
      } else {
        res = await fetch(`/api/v1/ical-feeds/${props.feed.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: name.trim(), url: url.trim(), color }),
        });
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      // After create or URL change, fire an initial sync so the user
      // immediately sees whether the feed actually loads.
      const idToRefresh =
        props.mode === "create" ? createdId : props.feed.id;
      if (idToRefresh) {
        await fetch(`/api/v1/ical-feeds/${idToRefresh}/refresh`, {
          method: "POST",
        }).catch(() => {
          // Non-fatal; the row will show its own error state.
        });
      }
      props.onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={props.onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {props.mode === "create" ? "Kalender hinzufügen" : "Kalender bearbeiten"}
          </h3>
          <Button variant="ghost" size="sm" aria-label="Schließen" onClick={props.onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cal-name">Name</Label>
            <Input
              id="cal-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Familie"
              maxLength={80}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cal-url">iCal-URL</Label>
            <Input
              id="cal-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://… oder webcal://…"
              type="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <p className="text-xs text-[var(--color-muted-fg)]">
              In Google Kalender unter Einstellungen → „Kalender integrieren“
              → „Geheime Adresse im iCal-Format“.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Farbe</Label>
            <div className="flex flex-wrap items-center gap-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Farbe ${c}`}
                  aria-pressed={color.toLowerCase() === c}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full border border-black/10 ring-offset-2 ring-offset-[var(--color-card)] transition-shadow dark:border-white/10",
                    color.toLowerCase() === c &&
                      "ring-2 ring-[var(--color-ring)]",
                  )}
                  style={{ backgroundColor: c }}
                >
                  {color.toLowerCase() === c ? (
                    <Check className="size-3.5 text-white drop-shadow" />
                  ) : null}
                </button>
              ))}
              <label className="ml-2 flex items-center gap-1 text-xs text-[var(--color-muted-fg)]">
                Hex
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value.toLowerCase())}
                  className="h-7 w-9 cursor-pointer rounded border border-[var(--color-border)] bg-transparent"
                />
              </label>
            </div>
          </div>

          {error ? (
            <p className="text-sm text-[var(--color-danger)]">{error}</p>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={submit} disabled={busy || !canSubmit}>
            {busy ? "Speichert…" : props.mode === "create" ? "Hinzufügen" : "Speichern"}
          </Button>
        </div>
      </div>
    </div>
  );
}
