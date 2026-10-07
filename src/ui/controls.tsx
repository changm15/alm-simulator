import { ReactNode, useId, useState } from "react";

/**
 * The control atoms.
 *
 * The rule they exist to enforce: a unit never lives in a label. "$" and "%"
 * are adornments inside the control, and anything that used to be a bare 0–1
 * ratio is a slider or a segmented control, because nobody reads 0.4 as
 * "some".
 */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="fl">{label}</div>
      {children}
      {hint ? <p className="fh">{hint}</p> : null}
    </div>
  );
}

export function NumberInput({
  label,
  value,
  onChange,
  prefix,
  suffix,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  step?: number;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label className="fl" htmlFor={id}>
        {label}
      </label>
      <div className={`ctl${prefix ? " pre" : ""}${suffix ? " suf" : ""}`}>
        {prefix ? <span className="adorn">{prefix}</span> : null}
        <input
          id={id}
          type="number"
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffix ? <span className="adorn suf">{suffix}</span> : null}
      </div>
      {hint ? <p className="fh">{hint}</p> : null}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="ctl" style={{ marginTop: 0 }}>
      <input
        type="text"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export interface Option<T> {
  value: T;
  label: string;
}

export function Segmented<T extends string | number | boolean>({
  label,
  value,
  options,
  onChange,
  hint,
  small,
  ariaLabel,
}: {
  label?: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  hint?: ReactNode;
  small?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div>
      {label ? <div className="fl">{label}</div> : null}
      <div
        className={small ? "seg sm" : "seg"}
        role="radiogroup"
        aria-label={ariaLabel ?? label}
      >
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            className={o.value === value ? "on" : undefined}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint ? <p className="fh">{hint}</p> : null}
    </div>
  );
}

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  display,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** What to show beside the label — defaults to the raw value. */
  display?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <div className="slider-head">
        <label className="fl" htmlFor={id}>
          {label}
        </label>
        <span className="slider-val">{display ?? value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint ? <p className="fh">{hint}</p> : null}
    </div>
  );
}

/** Advanced knobs fold away so the common path stays short. */
export function Disclosure({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="disclose"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Chevron open={open} />
        {label}
      </button>
      {open ? <div className="stack">{children}</div> : null}
    </>
  );
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={open ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} />
    </svg>
  );
}

export function Card({
  title,
  right,
  children,
  flat,
  style,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  flat?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <section className={flat ? "card flat" : "card"} style={style}>
      {title || right ? (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 14,
            marginBottom: 13,
          }}
        >
          {title ? <span className="eyebrow">{title}</span> : <span />}
          {right}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A proportional bar. Segments are {width fraction, color}. */
export function StackBar({
  segments,
  height = 9,
}: {
  segments: { key: string; fraction: number; color: string }[];
  height?: number;
}) {
  return (
    <div className="bar" style={{ height }}>
      {segments.map((s) => (
        <span
          key={s.key}
          style={{ width: `${Math.max(0, s.fraction) * 100}%`, background: s.color }}
        />
      ))}
    </div>
  );
}

export function Dot({ color }: { color: string }) {
  return <i className="dot" style={{ background: color }} />;
}
