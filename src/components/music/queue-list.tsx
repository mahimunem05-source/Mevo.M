import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, ChevronUp, EllipsisVertical, GripVertical, Trash2 } from "lucide-react";
import { formatTime, type Song } from "@/data/songs";
import { usePlayer } from "@/lib/player-context";
import { cn } from "@/lib/utils";
import { Equalizer } from "./equalizer";
import { SongCoverImage } from "./song-cover-image";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useTranslation } from "@/hooks/useTranslation";

export function QueueList({ song }: { song: Song }) {
  const {
    queue,
    currentIndex,
    current,
    isPlaying,
    playQueueIndex,
    removeFromQueue,
    reorderQueue,
    clearQueue,
  } = usePlayer();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeRowRef = useRef<HTMLLIElement | null>(null);
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [current?.id]);

  const handleSelect = (track: Song, index: number) => {
    const alreadyActive = current?.id === track.id && currentIndex === index;
    if (!alreadyActive) {
      playQueueIndex(index);
    }

    void navigate({
      to: "/song/$songId",
      params: { songId: track.id },
      replace: true,
    });
  };

  return (
    <aside aria-label="Up next playback queue" className="w-full">
      {/* Header: UP NEXT (left) | CLEAR (right) */}
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-[11px] font-extrabold uppercase tracking-[0.25em] text-teal-400/90">
          {t("player.upNext", "UP NEXT")}
        </h2>
        {queue.length > 1 && (
          <button
            type="button"
            onClick={() => setShowClearConfirm(true)}
            className="text-[11px] font-extrabold uppercase tracking-[0.25em] text-teal-400/90 hover:text-teal-300 transition-colors cursor-pointer"
          >
            {t("player.clear", "CLEAR")}
          </button>
        )}
      </header>

      {queue.length <= 1 ? (
        <p className="py-4 text-center text-xs text-white/50">No more songs in queue.</p>
      ) : (
        <ul className="space-y-2">
          {queue.map((track, index) => {
            const active = currentIndex === index && current?.id === track.id;
            const menuOpen = openMenuIndex === index;

            return (
              <motion.li
                key={`${track.id}-${index}`}
                ref={active ? activeRowRef : undefined}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.02, 0.2) }}
                className="relative"
              >
                <div
                  className={cn(
                    "group relative flex w-full items-center rounded-xl p-2 transition-all duration-200",
                    active ? "bg-[#182227] border border-[#4FD1C5]/40" : "hover:bg-white/[0.05]",
                  )}
                >
                  {/* Drag handle icon on far left */}
                  <GripVertical className="size-4 shrink-0 text-white/30 mr-2.5" />

                  {/* Main song button */}
                  <button
                    type="button"
                    onClick={() => handleSelect(track, index)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    {/* Album cover */}
                    <div className="relative size-11 shrink-0 overflow-hidden rounded-lg">
                      <SongCoverImage
                        src={track.cover}
                        alt=""
                        width={44}
                        height={44}
                        loading="eager"
                        decoding="auto"
                        className="size-full object-cover"
                      />
                      {active && isPlaying && (
                        <div className="absolute inset-0 grid place-items-center bg-black/40">
                          <Equalizer />
                        </div>
                      )}
                    </div>

                    {/* Title & Artist */}
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-sm font-semibold",
                          active ? "text-teal-400" : "text-white/95",
                        )}
                      >
                        {track.title}
                      </span>
                      <span className="block truncate text-xs text-white/60">{track.artist}</span>
                    </span>

                    {/* Duration */}
                    <span className="shrink-0 text-xs tabular-nums text-white/50 pr-1">
                      {formatTime(track.duration)}
                    </span>
                  </button>

                  {/* Three-dot options menu */}
                  <button
                    type="button"
                    aria-label={`Options for ${track.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenMenuIndex(menuOpen ? null : index);
                    }}
                    className="grid size-8 shrink-0 place-items-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <EllipsisVertical className="size-4" />
                  </button>

                  {/* Options Dropdown */}
                  <AnimatePresence>
                    {menuOpen && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-2 top-12 z-50 min-w-36 rounded-xl bg-[#182227] border border-[#4FD1C5]/30 p-1.5 shadow-2xl"
                      >
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => {
                            reorderQueue(index, index - 1);
                            setOpenMenuIndex(null);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-40"
                        >
                          <ChevronUp className="size-3.5 text-teal-400" /> Move Up
                        </button>
                        <button
                          type="button"
                          disabled={index === queue.length - 1}
                          onClick={() => {
                            reorderQueue(index, index + 1);
                            setOpenMenuIndex(null);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-40"
                        >
                          <ChevronDown className="size-3.5 text-teal-400" /> Move Down
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            removeFromQueue(index);
                            setOpenMenuIndex(null);
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 className="size-3.5" /> Remove
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}

      {/* Confirmation Dialog for Clearing Queue */}
      <ConfirmDialog
        open={showClearConfirm}
        title="Clear Up Next Queue?"
        description="Are you sure you want to remove all upcoming songs from your queue?"
        confirmText="Clear Queue"
        cancelText="Cancel"
        variant="danger"
        onConfirm={() => {
          clearQueue();
          setShowClearConfirm(false);
        }}
        onCancel={() => setShowClearConfirm(false)}
      />
    </aside>
  );
}
