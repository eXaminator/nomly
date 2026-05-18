"use client";

import * as React from "react";
import {
  Bold,
  Code,
  Eye,
  Heading,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { renderMarkdown } from "@/lib/markdown";

type Props = {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
  id?: string;
  className?: string;
};

type ToolbarOp =
  | { kind: "wrap"; left: string; right: string; placeholder: string }
  | { kind: "linePrefix"; prefix: string }
  | { kind: "heading" }
  | { kind: "link" };

export function MarkdownEditor({
  value,
  onChange,
  rows = 6,
  placeholder,
  id,
  className,
}: Props) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = React.useState<"edit" | "preview">("edit");

  function applyOp(op: ToolbarOp) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = value.slice(0, start);
    const selected = value.slice(start, end);
    const after = value.slice(end);

    let nextValue = value;
    let nextStart = start;
    let nextEnd = end;

    if (op.kind === "wrap") {
      const inner = selected || op.placeholder;
      nextValue = `${before}${op.left}${inner}${op.right}${after}`;
      nextStart = before.length + op.left.length;
      nextEnd = nextStart + inner.length;
    } else if (op.kind === "linePrefix") {
      // Toggle the prefix on every line of the current selection. If a single
      // empty line, insert at cursor.
      const { lineStart, lineEnd, lines } = extractLines(value, start, end);
      const allPrefixed = lines.every(
        (l) => l.startsWith(op.prefix) || l.length === 0,
      );
      const transformed = lines
        .map((l) => {
          if (l.length === 0) return op.prefix.trim();
          return allPrefixed
            ? l.slice(op.prefix.length)
            : `${op.prefix}${l}`;
        })
        .join("\n");
      nextValue =
        value.slice(0, lineStart) + transformed + value.slice(lineEnd);
      nextStart = lineStart;
      nextEnd = lineStart + transformed.length;
    } else if (op.kind === "heading") {
      const { lineStart, lineEnd, lines } = extractLines(value, start, end);
      const transformed = lines
        .map((l) => {
          const stripped = l.replace(/^#{1,6}\s*/, "");
          const current = l.match(/^(#{1,6})\s*/)?.[1].length ?? 0;
          const nextLevel = current >= 3 ? 0 : current + 1;
          return nextLevel === 0 ? stripped : `${"#".repeat(nextLevel)} ${stripped}`;
        })
        .join("\n");
      nextValue =
        value.slice(0, lineStart) + transformed + value.slice(lineEnd);
      nextStart = lineStart;
      nextEnd = lineStart + transformed.length;
    } else if (op.kind === "link") {
      const label = selected || "Link-Text";
      const url = "https://";
      nextValue = `${before}[${label}](${url})${after}`;
      // Place caret over the URL so the user can paste/replace immediately.
      const linkStart = before.length + 1 + label.length + 2;
      nextStart = linkStart;
      nextEnd = linkStart + url.length;
    }

    onChange(nextValue);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(nextStart, nextEnd);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === "b") {
      e.preventDefault();
      applyOp({ kind: "wrap", left: "**", right: "**", placeholder: "Fett" });
    } else if (key === "i") {
      e.preventDefault();
      applyOp({ kind: "wrap", left: "_", right: "_", placeholder: "Kursiv" });
    } else if (key === "k") {
      e.preventDefault();
      applyOp({ kind: "link" });
    }
  }

  const previewHtml = React.useMemo(
    () => (mode === "preview" ? renderMarkdown(value) : null),
    [mode, value],
  );

  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden",
        className,
      )}
    >
      <div className="flex items-center gap-0.5 border-b border-[var(--color-border)] bg-[var(--color-muted)]/50 p-1">
        <ToolbarButton
          label="Fett (Ctrl+B)"
          disabled={mode === "preview"}
          onClick={() =>
            applyOp({ kind: "wrap", left: "**", right: "**", placeholder: "Fett" })
          }
        >
          <Bold className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Kursiv (Ctrl+I)"
          disabled={mode === "preview"}
          onClick={() =>
            applyOp({ kind: "wrap", left: "_", right: "_", placeholder: "Kursiv" })
          }
        >
          <Italic className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Überschrift (zyklisch H1→H2→H3→aus)"
          disabled={mode === "preview"}
          onClick={() => applyOp({ kind: "heading" })}
        >
          <Heading className="size-4" />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton
          label="Aufzählung"
          disabled={mode === "preview"}
          onClick={() => applyOp({ kind: "linePrefix", prefix: "- " })}
        >
          <List className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Nummerierte Liste"
          disabled={mode === "preview"}
          onClick={() => applyOp({ kind: "linePrefix", prefix: "1. " })}
        >
          <ListOrdered className="size-4" />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton
          label="Link (Ctrl+K)"
          disabled={mode === "preview"}
          onClick={() => applyOp({ kind: "link" })}
        >
          <LinkIcon className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Inline-Code"
          disabled={mode === "preview"}
          onClick={() =>
            applyOp({ kind: "wrap", left: "`", right: "`", placeholder: "code" })
          }
        >
          <Code className="size-4" />
        </ToolbarButton>
        <div className="ml-auto flex items-center">
          <ToolbarButton
            label={mode === "edit" ? "Vorschau" : "Bearbeiten"}
            onClick={() => setMode(mode === "edit" ? "preview" : "edit")}
            active={mode === "preview"}
          >
            {mode === "edit" ? (
              <Eye className="size-4" />
            ) : (
              <Pencil className="size-4" />
            )}
            <span className="text-xs">
              {mode === "edit" ? "Vorschau" : "Bearbeiten"}
            </span>
          </ToolbarButton>
        </div>
      </div>
      {mode === "edit" ? (
        <textarea
          ref={textareaRef}
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={rows}
          placeholder={placeholder}
          className="block w-full resize-y bg-transparent px-3 py-2 font-mono text-sm leading-relaxed text-[var(--color-fg)] placeholder:text-[var(--color-muted-fg)] focus:outline-none"
          spellCheck
        />
      ) : (
        <div
          className={cn(
            "prose prose-sm max-w-none px-3 py-2 text-[var(--color-fg)] dark:prose-invert",
            !previewHtml && "text-[var(--color-muted-fg)] italic",
          )}
          style={{ minHeight: `${rows * 1.5}rem` }}
          dangerouslySetInnerHTML={
            previewHtml
              ? { __html: previewHtml }
              : { __html: "<em>Nichts zu zeigen.</em>" }
          }
        />
      )}
    </div>
  );
}

function ToolbarButton({
  children,
  label,
  onClick,
  disabled,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // Don't steal focus from the textarea on click — otherwise the user's
      // selection is gone by the time onClick runs and we lose the wrapping
      // target. preventDefault on mousedown is the canonical fix.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-[var(--color-muted-fg)] transition-colors",
        "hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
        active && "bg-[var(--color-bg)] text-[var(--color-fg)]",
        disabled && "opacity-40 hover:bg-transparent hover:text-[var(--color-muted-fg)]",
      )}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <div className="mx-1 h-5 w-px bg-[var(--color-border)]" />;
}

function extractLines(value: string, start: number, end: number) {
  let lineStart = start;
  while (lineStart > 0 && value[lineStart - 1] !== "\n") lineStart -= 1;
  let lineEnd = end;
  while (lineEnd < value.length && value[lineEnd] !== "\n") lineEnd += 1;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  return { lineStart, lineEnd, lines };
}
