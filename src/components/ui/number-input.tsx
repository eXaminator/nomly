"use client";

import * as React from "react";
import { Input, type InputProps } from "./input";

export type NumberInputProps = Omit<
  InputProps,
  "value" | "onChange" | "type" | "min" | "max"
> & {
  /** Numeric value; `null` means the field is empty. */
  value: number | null;
  onChange: (next: number | null) => void;
  min?: number;
  max?: number;
  /** When true, accepts decimals (German comma or dot). Otherwise integer-only. */
  decimal?: boolean;
};

/**
 * Text-backed numeric input. Unlike `<input type="number">`, the user can
 * fully clear the field, type partial values ("1,", "0.0"), and the displayed
 * text decouples from the parsed value during editing. Invalid characters are
 * rejected on input; range clamping happens on blur so transient out-of-range
 * values don't fight the user mid-edit.
 */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput(
    { value, onChange, min, max, decimal = false, inputMode, onFocus, onBlur, ...rest },
    ref,
  ) {
    const [text, setText] = React.useState(() => formatValue(value));
    const focusedRef = React.useRef(false);

    React.useEffect(() => {
      if (focusedRef.current) return;
      setText(formatValue(value));
    }, [value]);

    const accepts = decimal ? /^-?(\d*)([.,]\d*)?$/ : /^-?\d*$/;

    return (
      <Input
        ref={ref}
        type="text"
        inputMode={inputMode ?? (decimal ? "decimal" : "numeric")}
        value={text}
        onFocus={(e) => {
          focusedRef.current = true;
          onFocus?.(e);
        }}
        onChange={(e) => {
          const v = e.target.value;
          if (v.length > 0 && !accepts.test(v)) return;
          setText(v);
          const parsed = parseInput(v, decimal);
          if (parsed === null) {
            if (v.trim().length === 0) onChange(null);
            return;
          }
          onChange(parsed);
        }}
        onBlur={(e) => {
          focusedRef.current = false;
          const trimmed = text.trim();
          if (trimmed.length === 0) {
            onChange(null);
            setText("");
            onBlur?.(e);
            return;
          }
          const parsed = parseInput(trimmed, decimal);
          if (parsed === null) {
            setText(formatValue(value));
            onBlur?.(e);
            return;
          }
          const clamped = clamp(parsed, min, max);
          if (clamped !== value) onChange(clamped);
          setText(formatValue(clamped));
          onBlur?.(e);
        }}
        {...rest}
      />
    );
  },
);

function formatValue(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "";
  return String(v);
}

function parseInput(s: string, decimal: boolean): number | null {
  const cleaned = s.replace(",", ".").trim();
  if (cleaned.length === 0) return null;
  if (cleaned === "-" || cleaned === "." || cleaned === "-.") return null;
  if (!decimal && cleaned.includes(".")) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function clamp(v: number, min?: number, max?: number): number {
  let r = v;
  if (min !== undefined && r < min) r = min;
  if (max !== undefined && r > max) r = max;
  return r;
}
