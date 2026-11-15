import { useState } from "react";
import {
  AlertTriangle,
  Download,
  FolderOpen,
  Info,
  MoreHorizontal,
  Palette,
  Pencil,
  RefreshCw,
  Anchor,
  Plus,
} from "lucide-react";
import type { GeneratedImage, Message, Style } from "../../shared/types";
import { call } from "../lib/rpc";
import { mediaUrl } from "../lib/media";
import { formatTime, formatUsd } from "../lib/format";
import { Button, IconButton, Menu, MenuItem, Spinner, StylePill, cx, errorMessage, notify } from "./ui";
import { MAX_REFS } from "../lib/limits";

export function MessageItem({
  message,
  styles,
  parent,
  onReply,
  onZoom,
  onChanged,
}: {
  message: Message;
  styles: Style[];
  parent: GeneratedImage | null;
  onReply: (image: GeneratedImage) => void;
  onZoom: (image: GeneratedImage) => void;
  onChanged: () => void;
}) {
  const label = message.styleLabel;
  const trialStyle = message.kind === "trial" ? styles.find((s) => s.id === message.styleId) : undefined;
  const portrait = message.images[0]?.params.size === "1024x1536";
  const cols = message.images.length === 1 ? 1 : 2;

  return (
    <article className="flex flex-col gap-3">
      <div className="flex justify-end">
        <div className="max-w-[78%] rounded-2xl rounded-br-md bg-card px-4 py-2.5 shadow-card">
          <div className="mb-1 flex items-center justify-end gap-2 text-xs text-ink-3">
            {message.kind === "trial" && <span>Prove per lo stile</span>}
            {message.kind === "edit" && (
              <span className="flex items-center gap-1.5">
                {parent?.thumbPath && (
                  <img src={mediaUrl(parent.thumbPath)} alt="" className="size-5 rounded object-cover" />
                )}
                Modifica
              </span>
            )}
            <StylePill label={label} />
            <span>{formatTime(message.createdAt)}</span>
          </div>
          <p data-selectable className="text-[14.5px] whitespace-pre-wrap">
            {message.text}
          </p>
        </div>
      </div>

      {message.kind === "trial" && (
        <p className="text-[13px] text-ink-2">
          {trialStyle && trialStyle.refs.length === 0
            ? `Scegli la prova che ti piace di più: diventa l'àncora dello stile «${trialStyle.name}».`
            : "Prove dello stile."}
        </p>
      )}

      <div
        className={cx(
          "grid gap-3",
          cols === 1 ? (portrait ? "max-w-[360px]" : "max-w-[620px]") : "max-w-[820px]",
        )}
        style={{ gridTemplateColumns: `repeat(${message.kind === "trial" ? 3 : cols}, minmax(0, 1fr))` }}
      >
        {message.images.map((image) => (
          <ImageCard
            key={image.id}
            image={image}
            color={label?.color ?? null}
            styles={styles}
            trialStyle={trialStyle}
            onReply={onReply}
            onZoom={onZoom}
            onChanged={onChanged}
          />
        ))}
      </div>
    </article>
  );
}

function ImageCard({
  image,
  color,
  styles,
  trialStyle,
  onReply,
  onZoom,
  onChanged,
}: {
  image: GeneratedImage;
  color: string | null;
  styles: Style[];
  trialStyle: Style | undefined;
  onReply: (image: GeneratedImage) => void;
  onZoom: (image: GeneratedImage) => void;
  onChanged: () => void;
}) {
  const [details, setDetails] = useState(false);
  const [w, h] = image.params.size.split("x").map(Number) as [number, number];
  const aspect = `${w} / ${h}`;

  const run = async (fn: () => Promise<unknown>, after?: string) => {
    try {
      await fn();
      if (after) notify(after, "info");
      onChanged();
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  if (image.status === "queued" || image.status === "running") {
    return (
      <div
        className="shimmer flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-line text-[13px] text-ink-2"
        style={{ aspectRatio: aspect, borderTop: color ? `3px solid ${color}` : undefined }}
      >
        <Spinner className="text-ink-3" />
        {image.status === "queued" ? "In coda…" : "Sto disegnando…"}
        <span className="text-xs text-ink-3">Puoi continuare a scrivere</span>
      </div>
    );
  }

  if (image.status === "failed") {
    return (
      <div className="flex min-h-40 flex-col justify-center gap-2 rounded-[var(--radius-card)] border border-danger/25 bg-card p-4 text-[13px]">
        <p className="flex items-center gap-1.5 font-semibold text-danger">
          <AlertTriangle size={16} /> {image.error?.title ?? "Non riuscita"}
        </p>
        <p className="text-ink-2">{image.error?.detail}</p>
        <p className="text-ink">{image.error?.action}</p>
        <div>
          <Button size="sm" onClick={() => void run(() => call("imagesRegenerate", { imageId: image.id }))}>
            <RefreshCw size={14} /> Riprova
          </Button>
        </div>
      </div>
    );
  }

  const canAnchor = trialStyle && !trialStyle.locked && trialStyle.refs.length < MAX_REFS;

  return (
    <figure className="group relative m-0 overflow-hidden rounded-[var(--radius-card)] bg-card shadow-card">
      <button
        type="button"
        className={cx("block w-full", image.params.background === "transparent" && "checker")}
        style={{ aspectRatio: aspect }}
        onClick={() => onZoom(image)}
        aria-label="Ingrandisci"
      >
        <img src={mediaUrl(image.thumbPath)} alt="" loading="lazy" className="size-full object-cover" />
      </button>
      {color && <div className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />}

      <figcaption className="flex items-center gap-1 px-2 py-1.5">
        {canAnchor ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() =>
              void run(
                () => call("stylesUseImage", { imageId: image.id, styleId: trialStyle.id }),
                `Àncora aggiunta a «${trialStyle.name}». Sto ricavando la descrizione dello stile…`,
              )
            }
          >
            <Anchor size={14} /> {trialStyle.refs.length === 0 ? "Usa come àncora" : "Aggiungi come àncora"}
          </Button>
        ) : (
          <>
            <IconButton label="Modifica questa immagine" onClick={() => onReply(image)}>
              <Pencil size={16} />
            </IconButton>
            <IconButton
              label="Rigenera con gli stessi criteri"
              onClick={() => void run(() => call("imagesRegenerate", { imageId: image.id }))}
            >
              <RefreshCw size={16} />
            </IconButton>
          </>
        )}
        <div className="flex-1" />
        <IconButton
          label="Salva l'immagine…"
          onClick={() =>
            void run(async () => {
              const saved = await call("imagesExport", { imageId: image.id });
              if (saved) notify(`Immagine salvata: ${saved.split("/").pop()}`, "info");
            })
          }
        >
          <Download size={16} />
        </IconButton>
        <Menu
          align="right"
          trigger={(p) => (
            <IconButton label="Altre azioni" {...p}>
              <MoreHorizontal size={16} />
            </IconButton>
          )}
        >
          {(close) => (
            <>
              <p className="px-2.5 pt-1 pb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                Usa come stile
              </p>
              {styles.map((style) => {
                const full = style.locked || style.refs.length >= MAX_REFS;
                return (
                  <MenuItem
                    key={style.id}
                    disabled={full}
                    hint={full ? (style.locked ? "Stile bloccato" : "Ha già 3 riferimenti") : undefined}
                    onClick={() => {
                      close();
                      void run(
                        () => call("stylesUseImage", { imageId: image.id, styleId: style.id }),
                        `Aggiunta come riferimento di «${style.name}».`,
                      );
                    }}
                  >
                    <Palette size={15} style={{ color: style.color }} />
                    <span>
                      Riferimento per <b>{style.name}</b>
                    </span>
                  </MenuItem>
                );
              })}
              <MenuItem
                onClick={() => {
                  close();
                  void run(
                    () => call("stylesUseImage", { imageId: image.id, styleId: null }),
                    "Nuovo stile creato da questa immagine e aggiunto al progetto. Sto ricavando la descrizione…",
                  );
                }}
              >
                <Plus size={15} /> Nuovo stile da questa immagine
              </MenuItem>
              <div className="my-1 border-t border-line" />
              {canAnchor && (
                <>
                  <MenuItem
                    onClick={() => {
                      close();
                      onReply(image);
                    }}
                  >
                    <Pencil size={15} /> Modifica
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      close();
                      void run(() => call("imagesRegenerate", { imageId: image.id }));
                    }}
                  >
                    <RefreshCw size={15} /> Rigenera
                  </MenuItem>
                </>
              )}
              <MenuItem
                onClick={() => {
                  close();
                  void run(() => call("imagesReveal", { imageId: image.id }));
                }}
              >
                <FolderOpen size={15} /> Mostra nel Finder
              </MenuItem>
              <MenuItem
                onClick={() => {
                  close();
                  setDetails((d) => !d);
                }}
              >
                <Info size={15} /> {details ? "Nascondi i dettagli" : "Dettagli (avanzate)"}
              </MenuItem>
            </>
          )}
        </Menu>
      </figcaption>

      {details && (
        <div data-selectable className="border-t border-line bg-paper px-3 py-2 text-xs text-ink-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <dt className="text-ink-3">Modello</dt>
            <dd>{image.model}</dd>
            <dt className="text-ink-3">Parametri</dt>
            <dd>
              {image.params.size} · qualità {image.params.quality} · {image.params.inputPaths.length} immagini
              di input
            </dd>
            <dt className="text-ink-3">Token</dt>
            <dd>
              {image.inputTokens} in · {image.outputTokens} out
            </dd>
            <dt className="text-ink-3">Costo stimato</dt>
            <dd>{formatUsd(image.costUsd)}</dd>
          </dl>
          <p className="mt-2 mb-1 text-ink-3">Prompt finale</p>
          <pre className="max-h-48 overflow-auto font-sans whitespace-pre-wrap">{image.finalPrompt}</pre>
        </div>
      )}
    </figure>
  );
}
