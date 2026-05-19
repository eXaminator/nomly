"use client";
/* eslint-disable react-hooks/refs --
 * CodeMirror needs us to keep editor state outside React's render flow.
 * The ref + closure pattern below is read inside event callbacks that only
 * fire on user interaction, never during render — the lint rule is
 * conservative and produces false positives here.
 */

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
import { useTheme } from "next-themes";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
// keymap import is kept for the shortcut keymap (Mod-b/i/k) below.
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
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

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.5em", fontWeight: "700" },
  { tag: tags.heading2, fontSize: "1.3em", fontWeight: "700" },
  { tag: tags.heading3, fontSize: "1.15em", fontWeight: "700" },
  { tag: tags.heading, fontWeight: "700" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)" },
  { tag: tags.url, color: "var(--color-accent)", textDecoration: "underline" },
  { tag: tags.link, color: "var(--color-accent)" },
  { tag: tags.processingInstruction, color: "var(--color-muted-fg)" },
  { tag: tags.contentSeparator, color: "var(--color-muted-fg)" },
]);

const editorTheme = EditorView.theme({
  "&": {
    fontSize: "0.875rem",
    backgroundColor: "transparent",
  },
  ".cm-content": {
    fontFamily:
      "var(--font-sans), -apple-system, 'Segoe UI', system-ui, sans-serif",
    color: "var(--color-fg)",
    caretColor: "var(--color-fg)",
    padding: "0.5rem 0.75rem",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-line": { padding: "0 0" },
  ".cm-cursor": { borderLeftColor: "var(--color-fg)" },
  "&.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 30%, transparent)",
  },
});

export function MarkdownEditor({
  value,
  onChange,
  rows = 6,
  placeholder,
  id,
  className,
}: Props) {
  const cmRef = React.useRef<ReactCodeMirrorRef>(null);
  const [mode, setMode] = React.useState<"edit" | "preview">("edit");
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    // Flip a "mounted" flag so we only read client-only state (resolvedTheme)
    // after hydration. This is a classic next-themes pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  function applyOp(op: ToolbarOp) {
    const view = cmRef.current?.view;
    if (!view) return;
    const sel = view.state.selection.main;
    const before = sel.from;
    const after = sel.to;
    const selected = view.state.sliceDoc(before, after);

    if (op.kind === "wrap") {
      const inner = selected || op.placeholder;
      view.dispatch({
        changes: { from: before, to: after, insert: op.left + inner + op.right },
        selection: {
          anchor: before + op.left.length,
          head: before + op.left.length + inner.length,
        },
      });
    } else if (op.kind === "linePrefix") {
      const startLine = view.state.doc.lineAt(before);
      const endLine = view.state.doc.lineAt(after);
      const text = view.state.sliceDoc(startLine.from, endLine.to);
      const lines = text.split("\n");
      const allPrefixed = lines.every(
        (l) => l.startsWith(op.prefix) || l.length === 0,
      );
      const transformed = lines
        .map((l) => {
          if (l.length === 0) return op.prefix.trim();
          return allPrefixed ? l.slice(op.prefix.length) : `${op.prefix}${l}`;
        })
        .join("\n");
      view.dispatch({
        changes: { from: startLine.from, to: endLine.to, insert: transformed },
        selection: {
          anchor: startLine.from,
          head: startLine.from + transformed.length,
        },
      });
    } else if (op.kind === "heading") {
      const startLine = view.state.doc.lineAt(before);
      const endLine = view.state.doc.lineAt(after);
      const text = view.state.sliceDoc(startLine.from, endLine.to);
      const lines = text.split("\n");
      const transformed = lines
        .map((l) => {
          const stripped = l.replace(/^#{1,6}\s*/, "");
          const current = l.match(/^(#{1,6})\s*/)?.[1].length ?? 0;
          const next = current >= 3 ? 0 : current + 1;
          return next === 0 ? stripped : `${"#".repeat(next)} ${stripped}`;
        })
        .join("\n");
      view.dispatch({
        changes: { from: startLine.from, to: endLine.to, insert: transformed },
        selection: {
          anchor: startLine.from,
          head: startLine.from + transformed.length,
        },
      });
    } else if (op.kind === "link") {
      const label = selected || "Link-Text";
      const url = "https://";
      const inserted = `[${label}](${url})`;
      const urlStart = before + 1 + label.length + 2;
      view.dispatch({
        changes: { from: before, to: after, insert: inserted },
        selection: { anchor: urlStart, head: urlStart + url.length },
      });
    }
    view.focus();
  }

  // Enter inside a list item inserts the next marker; on an empty marker
  // line it exits the list (clears the marker). The lang-markdown extension
  // does insertion but not exit, so we run our own handler at Prec.highest
  // and only fall through when neither case applies.
  const listKeymap = React.useMemo(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: "Enter",
            run: (view) => {
              const sel = view.state.selection.main;
              if (sel.from !== sel.to) return false;
              const line = view.state.doc.lineAt(sel.from);
              const m = line.text.match(/^(\s*)([-*+]\s+|(\d+)\.\s+)(.*)$/);
              if (!m) return false;
              const [, indent, marker, ordinal, content] = m;
              if (content.length === 0) {
                view.dispatch({
                  changes: { from: line.from, to: line.to, insert: "" },
                });
                return true;
              }
              const nextMarker = ordinal
                ? `${parseInt(ordinal, 10) + 1}${marker.slice(ordinal.length)}`
                : marker;
              const insert = `\n${indent}${nextMarker}`;
              view.dispatch({
                changes: { from: sel.from, to: sel.from, insert },
                selection: { anchor: sel.from + insert.length },
              });
              return true;
            },
          },
        ]),
      ),
    [],
  );

  // applyOp closes over the latest cmRef, which we want to stay current. Keep
  // a stable function via useRef + a getter so the keymap below doesn't
  // re-create extensions on every render.
  const applyOpRef = React.useRef(applyOp);
  React.useEffect(() => {
    applyOpRef.current = applyOp;
  });
  const callApplyOp = React.useCallback(
    (op: ToolbarOp) => applyOpRef.current(op),
    [],
  );

  const shortcutKeymap = React.useMemo(
    () =>
      Prec.high(
        keymap.of([
          {
            key: "Mod-b",
            run: () => {
              callApplyOp({
                kind: "wrap",
                left: "**",
                right: "**",
                placeholder: "Fett",
              });
              return true;
            },
          },
          {
            key: "Mod-i",
            run: () => {
              callApplyOp({
                kind: "wrap",
                left: "_",
                right: "_",
                placeholder: "Kursiv",
              });
              return true;
            },
          },
          {
            key: "Mod-k",
            run: () => {
              callApplyOp({ kind: "link" });
              return true;
            },
          },
        ]),
      ),
    [callApplyOp],
  );

  const extensions = React.useMemo(
    () => [
      markdown(),
      syntaxHighlighting(markdownHighlight),
      editorTheme,
      EditorView.lineWrapping,
      listKeymap,
      shortcutKeymap,
    ],
    [listKeymap, shortcutKeymap],
  );

  const previewHtml = React.useMemo(
    () => (mode === "preview" ? renderMarkdown(value) : null),
    [mode, value],
  );

  const minHeight = `${rows * 1.5 + 1}rem`;
  // `mounted` flag avoids the next-themes hydration mismatch; resolvedTheme
  // is read only for symmetry — actual theming is driven by our CSS vars in
  // editorTheme, so nothing else depends on this value yet.
  void mounted;
  void resolvedTheme;

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
        <div id={id} style={{ minHeight }}>
          <CodeMirror
            ref={cmRef}
            value={value}
            onChange={onChange}
            extensions={extensions}
            placeholder={placeholder}
            // `none` skips the bundled dark/light theme wrappers that paint
            // their own background on `.cm-editor` and clash with our card
            // colours. Our editorTheme inside `extensions` drives all of the
            // editor's visual styling via the app's CSS variables.
            theme="none"
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
              dropCursor: true,
              indentOnInput: false,
              bracketMatching: false,
              autocompletion: false,
              searchKeymap: false,
            }}
            style={{ minHeight }}
          />
        </div>
      ) : (
        <div
          className={cn(
            "markdown px-3 py-2 text-[var(--color-fg)]",
            !previewHtml && "italic text-[var(--color-muted-fg)]",
          )}
          style={{ minHeight }}
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
