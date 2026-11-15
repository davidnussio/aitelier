import { Palette, Plus, Settings as SettingsIcon } from "lucide-react";
import type { Settings, ThreadSummary } from "../../shared/types";
import { formatUsd } from "../lib/format";
import logoUrl from "../assets/logo.webp";
import { Button, IconButton, cx } from "./ui";

export function Sidebar({
  threads,
  currentId,
  settings,
  onSelect,
  onNew,
  onSettings,
  styleCount,
  stylesActive,
  onStyles,
}: {
  threads: ThreadSummary[];
  currentId: string | null;
  settings: Settings | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
  styleCount: number;
  stylesActive: boolean;
  onStyles: () => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col bg-paper-2/60">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <img src={logoUrl} alt="" className="size-8 shrink-0" />
        <span className="font-serif text-[22px] leading-none">AItelier</span>
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

      <div className="px-2 pb-2">
        <button
          type="button"
          onClick={onStyles}
          aria-current={stylesActive ? "page" : undefined}
          className={cx(
            "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13.5px] font-medium transition-colors",
            stylesActive ? "bg-card shadow-card" : "hover:bg-card/60",
          )}
        >
          <Palette size={16} className="text-accent" />
          <span className="flex-1">Stili</span>
          <span className="text-xs font-normal text-ink-3">{styleCount}</span>
        </button>
      </div>

      <p className="px-5 pt-1 pb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Progetti</p>
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
