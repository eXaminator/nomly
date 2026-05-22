"use client";

import * as React from "react";
import { Check, Image as ImageIcon, Link as LinkIcon, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  photoPath: string | null;
  onPhotoPathChange: (path: string | null) => void;
  photoUrl: string;
  onPhotoUrlChange: (url: string) => void;
};

function looksLikeHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function PhotoUpload({
  photoPath,
  onPhotoPathChange,
  photoUrl,
  onPhotoUrlChange,
}: Props) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [justUploaded, setJustUploaded] = React.useState(false);

  const trimmedUrl = photoUrl.trim();
  const urlPreviewable = trimmedUrl.length > 0 && looksLikeHttpUrl(trimmedUrl);
  // The URL takes precedence over photoPath: the server will replace the
  // path with the freshly-downloaded file on save.
  const previewSrc = urlPreviewable
    ? trimmedUrl
    : photoPath
      ? `/api/v1/${photoPath}`
      : null;

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
      onPhotoPathChange(data.path);
      // Uploading wins over any URL the user typed earlier.
      onPhotoUrlChange("");
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

  function clearPhoto() {
    onPhotoPathChange(null);
    onPhotoUrlChange("");
    setJustUploaded(false);
    setError(null);
  }

  const hasAnyPhoto = previewSrc !== null;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-4">
        <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted)]">
          {uploading ? (
            <Loader2 className="size-8 animate-spin text-[var(--color-muted-fg)]" />
          ) : previewSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewSrc}
              alt="Vorschau"
              className="h-full w-full object-cover"
              onError={() => {
                if (urlPreviewable) {
                  setError("Vorschau der URL fehlgeschlagen.");
                }
              }}
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
          <Button variant="outline" onClick={openPicker} disabled={uploading}>
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {hasAnyPhoto ? "Anderes Foto wählen" : "Foto hochladen"}
          </Button>
          {hasAnyPhoto ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearPhoto}
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

      <div className="relative">
        <LinkIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted-fg)]" />
        <Input
          type="url"
          value={photoUrl}
          onChange={(e) => onPhotoUrlChange(e.target.value)}
          placeholder="…oder Foto-URL einfügen (wird beim Speichern geladen)"
          className="pl-9"
          aria-label="Foto-URL"
          disabled={uploading}
        />
      </div>
      {trimmedUrl.length > 0 && !urlPreviewable ? (
        <p className="text-xs text-[var(--color-muted-fg)]">
          Erwarte eine http(s)-URL. Wird beim Speichern überprüft.
        </p>
      ) : null}
    </div>
  );
}
