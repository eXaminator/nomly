"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  ShieldOff,
  TriangleAlert,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { TokenScope } from "@/lib/bearer";

export type TokenSummary = {
  id: number;
  name: string;
  scope: TokenScope;
  createdAt: number;
  lastUsedAt: number | null;
};

type MintedToken = { id: number; name: string; scope: TokenScope; token: string };

const SCOPE_LABEL: Record<TokenScope, string> = {
  full: "Voll",
  embed: "Embed · nur Lesen",
};

type Props = { initial: TokenSummary[] };

export function ApiTokensPageClient({ initial }: Props) {
  const router = useRouter();
  const [tokens, setTokens] = React.useState(initial);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setTokens(initial), [initial]);
  const [creating, setCreating] = React.useState(false);
  const [revealed, setRevealed] = React.useState<MintedToken | null>(null);
  const [revokeCandidate, setRevokeCandidate] =
    React.useState<TokenSummary | null>(null);
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function confirmRevoke() {
    if (!revokeCandidate) return;
    setError(null);
    setBusyId(revokeCandidate.id);
    try {
      const res = await fetch(`/api/v1/api-tokens/${revokeCandidate.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await readError(res));
      setRevokeCandidate(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--color-muted-fg)]">
          Tokens{tokens.length > 0 ? ` (${tokens.length})` : ""}
        </h2>
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          Token erstellen
        </Button>
      </div>

      {error ? (
        <p className="rounded-[var(--radius)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      {tokens.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-6 py-12 text-center text-sm text-[var(--color-muted-fg)]">
          Noch keine Tokens. Erstelle einen, um Home Assistant oder den
          Familywall-Import auf die nomly-API zugreifen zu lassen.
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)]">
          {tokens.map((token) => (
            <TokenRow
              key={token.id}
              token={token}
              busy={busyId === token.id}
              onRevoke={() => setRevokeCandidate(token)}
            />
          ))}
        </ul>
      )}

      {creating ? (
        <CreateTokenDialog
          onClose={() => setCreating(false)}
          onCreated={(minted) => {
            setCreating(false);
            setRevealed(minted);
            router.refresh();
          }}
        />
      ) : null}

      {revealed ? (
        <TokenRevealDialog
          minted={revealed}
          onClose={() => setRevealed(null)}
        />
      ) : null}

      {revokeCandidate ? (
        <RevokeConfirm
          token={revokeCandidate}
          busy={busyId === revokeCandidate.id}
          onCancel={() => setRevokeCandidate(null)}
          onConfirm={confirmRevoke}
        />
      ) : null}
    </div>
  );
}

function TokenRow({
  token,
  busy,
  onRevoke,
}: {
  token: TokenSummary;
  busy: boolean;
  onRevoke: () => void;
}) {
  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
      <div className="flex flex-1 items-center gap-3">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
        >
          <KeyRound className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{token.name}</span>
            <Badge variant={token.scope === "embed" ? "warning" : "outline"}>
              {SCOPE_LABEL[token.scope]}
            </Badge>
          </span>
          <span className="truncate text-xs text-[var(--color-muted-fg)]">
            Erstellt {formatRelative(token.createdAt)}
            {" · "}
            {token.lastUsedAt
              ? `zuletzt verwendet ${formatRelative(token.lastUsedAt)}`
              : "noch nie verwendet"}
          </span>
        </div>
      </div>
      <div className="flex items-center">
        <Button
          variant="ghost"
          size="sm"
          className="text-[var(--color-danger)]"
          disabled={busy}
          onClick={onRevoke}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ShieldOff className="size-4" />
          )}
          Widerrufen
        </Button>
      </div>
    </li>
  );
}

function CreateTokenDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (minted: MintedToken) => void;
}) {
  const [name, setName] = React.useState("");
  const [scope, setScope] = React.useState<TokenScope>("full");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const canSubmit = name.trim().length > 0;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/api-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), scope }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const minted = (await res.json()) as MintedToken;
      onCreated(minted);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
      setBusy(false);
    }
  }

  return (
    <DialogShell onClose={onClose} labelledBy="create-token-title">
      <div className="flex items-center justify-between">
        <h3 id="create-token-title" className="text-lg font-semibold">
          Token erstellen
        </h3>
        <Button variant="ghost" size="sm" aria-label="Schließen" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="token-name">Name</Label>
          <Input
            id="token-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit && !busy) submit();
            }}
            placeholder="z. B. Home Assistant"
            maxLength={80}
          />
          <p className="text-xs text-[var(--color-muted-fg)]">
            Ein Label, an dem du den Token später wiedererkennst. Der Token wird
            nach dem Erstellen nur einmal angezeigt.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="token-scope">Berechtigung</Label>
          <select
            id="token-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as TokenScope)}
            className="h-9 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            <option value="full">Voll — gesamte API (Lesen + Schreiben)</option>
            <option value="embed">Embed — nur Lesen (Rezept-iframe)</option>
          </select>
          <p className="text-xs text-[var(--color-muted-fg)]">
            {scope === "embed" ? (
              <>
                Nur-Lesen, beschränkt auf die Rezept-Ansicht
                (<code className="rounded bg-[var(--color-muted)] px-1 py-0.5">/embed/…</code>).
                Wird als <code className="rounded bg-[var(--color-muted)] px-1 py-0.5">?k=&lt;token&gt;</code>{" "}
                in der iframe-URL übergeben — gedacht fürs Home-Assistant-Dashboard.
              </>
            ) : (
              <>Voller Zugriff auf die API — z. B. für Sensoren, Einkaufsliste oder den Familywall-Import.</>
            )}
          </p>
        </div>

        {error ? (
          <p className="text-sm text-[var(--color-danger)]">{error}</p>
        ) : null}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Abbrechen
        </Button>
        <Button onClick={submit} disabled={!canSubmit || busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Erstellen
        </Button>
      </div>
    </DialogShell>
  );
}

function TokenRevealDialog({
  minted,
  onClose,
}: {
  minted: MintedToken;
  onClose: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(minted.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. non-secure context) — the field is
      // selectable so the user can copy manually.
    }
  }

  return (
    <DialogShell onClose={onClose} labelledBy="reveal-token-title">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
          <KeyRound className="size-5" />
        </span>
        <div>
          <h3 id="reveal-token-title" className="text-lg font-semibold">
            Token „{minted.name}“ erstellt
          </h3>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--color-danger)]">
            <TriangleAlert className="size-4 shrink-0" />
            Wird nur jetzt angezeigt. Kopiere ihn an einen sicheren Ort.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-stretch gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 font-mono text-sm">
          {minted.token}
        </code>
        <Button
          variant="outline"
          aria-label="Token kopieren"
          onClick={copy}
          className="shrink-0"
        >
          {copied ? (
            <>
              <Check className="size-4 text-[var(--color-success)]" />
              Kopiert
            </>
          ) : (
            <>
              <Copy className="size-4" />
              Kopieren
            </>
          )}
        </Button>
      </div>

      <p className="mt-3 text-xs text-[var(--color-muted-fg)]">
        {minted.scope === "embed" ? (
          <>
            Übergib ihn als{" "}
            <code className="rounded bg-[var(--color-muted)] px-1 py-0.5">
              ?k={"<token>"}
            </code>{" "}
            in der iframe-URL (
            <code className="rounded bg-[var(--color-muted)] px-1 py-0.5">
              /embed/rezepte/…
            </code>
            ).
          </>
        ) : (
          <>
            Sende ihn als{" "}
            <code className="rounded bg-[var(--color-muted)] px-1 py-0.5">
              Authorization: Bearer {"<token>"}
            </code>
            .
          </>
        )}{" "}
        Verloren? Erstelle einfach einen neuen und widerrufe diesen.
      </p>

      <div className="mt-5 flex justify-end">
        <Button onClick={onClose}>Fertig</Button>
      </div>
    </DialogShell>
  );
}

function RevokeConfirm({
  token,
  busy,
  onCancel,
  onConfirm,
}: {
  token: TokenSummary;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogShell onClose={onCancel} labelledBy="revoke-token-title">
      <h3 id="revoke-token-title" className="text-lg font-semibold">
        Token widerrufen?
      </h3>
      <p className="mt-2 text-sm text-[var(--color-muted-fg)]">
        „{token.name}“ wird sofort ungültig und aus der Liste entfernt. Clients,
        die ihn verwenden (z. B. Home Assistant), erhalten danach{" "}
        <code>401</code> und müssen einen neuen Token bekommen. Das kann nicht
        rückgängig gemacht werden.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Abbrechen
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={busy}>
          {busy ? "Widerrufe…" : "Widerrufen"}
        </Button>
      </div>
    </DialogShell>
  );
}

function DialogShell({
  children,
  onClose,
  labelledBy,
}: {
  children: React.ReactNode;
  onClose: () => void;
  labelledBy: string;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-xl"
      >
        {children}
      </div>
    </div>
  );
}

function formatRelative(unix: number): string {
  const deltaSec = Math.floor(Date.now() / 1000) - unix;
  if (deltaSec < 60) return "gerade eben";
  if (deltaSec < 3600) return `vor ${Math.floor(deltaSec / 60)} min`;
  if (deltaSec < 86400) return `vor ${Math.floor(deltaSec / 3600)} h`;
  return `vor ${Math.floor(deltaSec / 86400)} Tagen`;
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  return body.message ?? `HTTP ${res.status}`;
}
