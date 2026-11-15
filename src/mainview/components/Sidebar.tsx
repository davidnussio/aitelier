import { Plus, Settings as SettingsIcon } from "lucide-react";
import type { Settings, ThreadSummary } from "../../shared/types";
import { formatUsd } from "../lib/format";
import { Button, IconButton, cx } from "./ui";

export function Sidebar({
  threads,
  currentId,
  settings,
  onSelect,
  onNew,
  onSettings,
}: {
  threads: ThreadSummary[];
  currentId: string | null;
  settings: Settings | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col bg-paper-2/60">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <Logo />
        <span className="font-serif text-[22px] leading-none">Bottega</span>
        {settings?.demo && (
          <span className="ml-auto rounded-full bg-accent/12 px-2 py-0.5 text-[11px] font-medium text-accent">
            demo
          </span>
        )}
      </div>

      <div className="px-3 pb-2">
        <Button className="w-full justify-start" onClick={onNew}>
          <Plus size={16} /> Nuovo progetto
        </Button>
      </div>

      <nav aria-label="Progetti" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {threads.length === 0 && <p className="px-3 py-4 text-[13px] text-ink-3">Nessun progetto per ora.</p>}
        {threads.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            aria-current={t.id === currentId ? "page" : undefined}
            className={cx(
              "mb-0.5 flex w-full flex-col items-start rounded-lg px-3 py-2 text-left transition-colors",
              t.id === currentId ? "bg-card shadow-card" : "hover:bg-card/60",
            )}
          >
            <span className="w-full truncate text-[13.5px] font-medium">{t.title}</span>
            <span className="mt-1 flex items-center gap-1.5 text-xs text-ink-3">
              {t.styleColors.map((c, i) => (
                <span key={i} className="size-2 rounded-full" style={{ background: c }} />
              ))}
              <span>
                {t.imageCount} {t.imageCount === 1 ? "immagine" : "immagini"}
              </span>
            </span>
          </button>
        ))}
      </nav>

      <div className="flex items-center gap-2 border-t border-line px-3 py-2">
        <div className="min-w-0 flex-1 text-xs text-ink-3">
          {settings && (
            <>
              Questo mese <span className="font-medium text-ink-2">{formatUsd(settings.monthCostUsd)}</span>
            </>
          )}
        </div>
        <IconButton label="Impostazioni" onClick={onSettings}>
          <SettingsIcon size={18} />
        </IconButton>
      </div>
    </aside>
  );
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
      <path
        d="M16 3c7.5 0 13 5 13 11.5 0 4-3 6-6 6h-2.5a2.5 2.5 0 0 0-1.7 4.3c1 1 .3 4.2-2.8 4.2C8.6 29 3 23.2 3 16S8.6 3 16 3Z"
        fill="#b5482a"
      />
      <circle cx="10" cy="13" r="2.2" fill="#f6f1e8" />
      <circle cx="16" cy="9" r="2.2" fill="#e8b04a" />
      <circle cx="22" cy="12.5" r="2.2" fill="#2f6db5" />
      <circle cx="9.5" cy="20" r="2.2" fill="#3f8f5a" />
    </svg>
  );
}
