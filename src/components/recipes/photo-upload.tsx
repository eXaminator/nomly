"use client";

import * as React from "react";
import { Check, Image as ImageIcon, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  value: string | null;
  onChange: (path: string | null) => void;
};

export function PhotoUpload({ value, onChange }: Props) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [justUploaded, setJustUploaded] = React.useState(false);

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
    setJustUploaded(false);
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
      setJustUploaded(true);
      window.setTimeout(() => setJustUploaded(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload fehlgeschlagen");
    } finally {
      setUploading(false);
    }
  }

  function openPicker() {
    inputRef.current?.click();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-4">
        <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted)]">
          {uploading ? (
            <Loader2 className="size-8 animate-spin text-[var(--color-muted-fg)]" />
          ) : value ? (
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
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              // Reset so picking the same file again still triggers onChange.
              e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            onClick={openPicker}
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
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange(null);
                setJustUploaded(false);
              }}
              disabled={uploading}
            >
              <X className="size-4" />
              Foto entfernen
            </Button>
          ) : null}
          {justUploaded ? (
            <p className="inline-flex items-center gap-1 text-xs text-[var(--color-success)]">
              <Check className="size-3.5" />
              Foto hochgeladen
            </p>
          ) : null}
          {error ? (
            <p className="text-xs text-[var(--color-danger)]">{error}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
