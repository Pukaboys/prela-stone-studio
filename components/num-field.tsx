"use client";
import { useState } from "react";

/**
 * Numeric field that keeps a local text draft, so users can clear the field
 * and type a new value. Only valid, in-range numbers are committed; the field
 * reverts to the last committed value on blur or Escape.
 */
export default function Num({
  label,
  value,
  onChange,
  min = 0,
  max = 20000,
  unit = "mm",
  compact = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  unit?: string;
  /** Hide the visible label (still used as the accessible name). */
  compact?: boolean;
}) {
  // `draft` holds what the user is typing; it is null until they type, so a
  // focused field still follows the value when something else changes it
  // (e.g. the 45° chamfer button or the assembly pad).
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(value);
  const parsed = Number(text);
  const invalid =
    draft !== null &&
    (text.trim() === "" || !Number.isFinite(parsed) || parsed < min || parsed > max);
  return (
    <label className={"field" + (invalid ? " invalid" : "") + (compact ? " compact" : "")}>
      <span className={compact ? "sr-only" : undefined}>{label}</span>
      <div>
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          value={text}
          aria-invalid={invalid || undefined}
          title={`${min} – ${max} ${unit}`}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            const n = Number(next);
            if (next.trim() !== "" && Number.isFinite(n) && n >= min && n <= max && n !== value)
              onChange(n);
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(null);
              e.currentTarget.blur();
            }
          }}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
}
