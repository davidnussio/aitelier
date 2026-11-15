import { useEffect } from "react";
import { X } from "lucide-react";
import type { GeneratedImage } from "../../shared/types";
import { mediaUrl } from "../lib/media";
import { cx } from "./ui";

export function Lightbox({ image, onClose }: { image: GeneratedImage; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-8" onClick={onClose}>
      <img
        src={mediaUrl(image.path)}
        alt=""
        className={cx(
          "max-h-full max-w-full rounded-lg shadow-pop",
          image.params.background === "transparent" && "checker",
        )}
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        aria-label="Chiudi"
        onClick={onClose}
        className="absolute top-4 right-4 rounded-full bg-paper/90 p-2 text-ink hover:bg-paper"
      >
        <X size={18} />
      </button>
    </div>
  );
}
