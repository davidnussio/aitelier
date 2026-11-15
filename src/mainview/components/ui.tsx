import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef, useState } from "react";
import { create } from "./store";
import { SLOT_LETTER, type StyleLabel } from "../../shared/types";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" ? "h-7 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-accent text-white hover:bg-accent-2",
        variant === "secondary" && "border border-line-2 bg-card text-ink hover:bg-paper-2",
        variant === "ghost" && "text-ink-2 hover:bg-paper-2 hover:text-ink",
        variant === "danger" && "border border-danger/30 bg-card text-danger hover:bg-danger/8",
        className,
      )}
    />
  );
}

export function IconButton({
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={cx(
        "inline-flex size-8 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink disabled:opacity-40",
        className,
      )}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent",
        className,
      )}
    />
  );
}

export function StylePill({ label, compact }: { label: StyleLabel | null; compact?: boolean }) {
  if (!label) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-line-2 px-2 py-0.5 text-xs text-ink-3">
        Nessuno stile
      </span>
    );
  }
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: `${label.color}1f`, color: label.color }}
    >
      <span className="size-2 shrink-0 rounded-full" style={{ background: label.color }} />
      {label.slot && <span className="font-semibold">{SLOT_LETTER[label.slot]}</span>}
      {!compact && <span className="truncate">{label.name}</span>}
    </span>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/30 p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label={typeof title === "string" ? title : undefined}
        className="max-h-full w-full overflow-auto rounded-2xl border border-line bg-card p-6 shadow-pop"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 font-serif text-xl">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Menu a comparsa ancorato a un pulsante. */
export function Menu({
  trigger,
  children,
  align = "left",
}: {
  trigger: (props: { onClick: () => void; "aria-expanded": boolean }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open })}
      {open && (
        <div
          role="menu"
          className={cx(
            "absolute z-30 mt-1 min-w-56 rounded-xl border border-line bg-card p-1 shadow-pop",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  children,
  onClick,
  disabled,
  hint,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      title={hint}
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-paper-2 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

// --- Avvisi ---

interface Toast {
  id: number;
  message: string;
  tone: "error" | "info";
}

const toastStore = create<Toast[]>([]);
let toastId = 0;

export function notify(message: string, tone: Toast["tone"] = "error") {
  const id = ++toastId;
  toastStore.set((list) => [...list, { id, message, tone }]);
  setTimeout(() => toastStore.set((list) => list.filter((t) => t.id !== id)), tone === "error" ? 9000 : 4000);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function Toaster() {
  const toasts = toastStore.use();
  return (
    <div className="pointer-events-none fixed top-4 right-4 z-50 flex w-96 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cx(
            "pointer-events-auto rounded-xl border bg-card px-4 py-3 text-[13px] shadow-pop",
            t.tone === "error" ? "border-danger/30 text-ink" : "border-line text-ink",
          )}
          onClick={() => toastStore.set((list) => list.filter((x) => x.id !== t.id))}
        >
          {t.tone === "error" && <span className="mr-1 font-semibold text-danger">Attenzione.</span>}
          {t.message}
        </div>
      ))}
    </div>
  );
}
