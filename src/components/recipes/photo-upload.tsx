"use client";

import * as React from "react";
import { Image as ImageIcon, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  value: string | null;
  onChange: (path: string | null) => void;
};

export function PhotoUpload({ value, onChange }: Props) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.set("photo", file);
      const res = await fetch("/api/v1/photos", { method: "POST", body: form });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { path: string };
      onChange(data.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload fehlgeschlagen");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-4">
        <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted)]">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/v1/${value}`}
              alt="Vorschau"
              className="h-full w-full object-cover"
            />
          ) : (
            <ImageIcon className="size-8 text-[var(--color-muted-fg)]" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {value ? "Anderes Foto wählen" : "Foto hochladen"}
          </Button>
          {value ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(null)}
            >
              <X className="size-4" />
              Foto entfernen
            </Button>
          ) : null}
          {error ? (
            <p className="text-xs text-[var(--color-danger)]">{error}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
