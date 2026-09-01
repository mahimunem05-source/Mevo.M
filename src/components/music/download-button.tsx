import { Download, Check, LoaderCircle, X } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import type { Song } from "@/data/songs";
import { useDownloads } from "@/hooks/useDownloads";

interface Props {
  song: Song;
  variant?: "icon" | "full" | "minimal";
  className?: string;
}

/**
 * Download button connected to IndexedDB offline storage engine.
 * Displays real-time download status: Not downloaded, Downloading (progress %), Downloaded.
 */
export function DownloadButton({ song, variant = "icon", className }: Props) {
  const {
    isDownloaded,
    isDownloading,
    getProgress,
    startDownload,
    cancelDownload,
    removeDownload,
  } = useDownloads();

  const downloaded = isDownloaded(song.id);
  const downloading = isDownloading(song.id);
  const progress = getProgress(song.id);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (downloading) {
      cancelDownload(song.id);
      return;
    }
    if (downloaded) {
      void removeDownload(song);
      return;
    }
    void startDownload(song);
  };

  const label = downloaded
    ? `Remove download for ${song.title}`
    : downloading
      ? `Cancel download for ${song.title}`
      : `Download ${song.title}`;

  if (variant === "minimal") {
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={handleClick}
        className={cn(
          "grid size-10 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/80 hover:bg-white/15 hover:text-white transition-colors",
          className,
        )}
      >
        {downloaded ? (
          <Check className="size-4 text-teal-400" />
        ) : downloading ? (
          <LoaderCircle className="size-4 animate-spin text-teal-400" />
        ) : (
          <Download className="size-4" />
        )}
      </button>
    );
  }

  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      onClick={handleClick}
      whileHover={{ scale: 1.04, y: -1 }}
      whileTap={{ scale: 0.96 }}
      className={cn(
        "relative inline-flex items-center justify-center overflow-hidden rounded-full font-semibold transition-all duration-200 border border-white/10 bg-white/[0.06] text-white hover:bg-white/10",
        variant === "icon" ? "size-10 gap-0" : "h-10 px-4 gap-2 text-xs sm:text-sm shadow-md",
        downloaded && "border-[#4FD1C5]/40 bg-[#4FD1C5]/10 text-teal-400",
        className,
      )}
    >
      {downloaded ? (
        <motion.div
          key="downloaded-check"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 22 }}
        >
          <Check className="size-4 text-teal-400" />
        </motion.div>
      ) : downloading ? (
        <X className="size-4 text-teal-400" />
      ) : (
        <Download className="size-4 text-teal-400" />
      )}

      {variant === "full" && (
        <span className="truncate">
          {downloaded ? "Offline" : downloading ? `${progress}%` : "Download"}
        </span>
      )}

      {downloading && (
        <span
          className="absolute inset-x-0 bottom-0 h-[3px] bg-[#4FD1C5] transition-all duration-200"
          style={{ width: `${progress}%` }}
        />
      )}
    </motion.button>
  );
}
