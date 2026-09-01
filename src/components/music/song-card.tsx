import { memo } from "react";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Play, Pause, Flame, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatTime,
  isSongExplicit,
  type NavigationSource,
  type QueueSource,
  type Song,
} from "@/data/songs";
import { usePlayer } from "@/lib/player-context";
import { useNavigationHistory } from "@/lib/navigation-history";
import { useSettings } from "@/context/SettingsContext";
import { toast } from "sonner";
import { Equalizer } from "./equalizer";
import { SongCoverImage } from "./song-cover-image";

interface Props {
  song: Song;
  /**
   * Smaller footprint for grid/"See All" pages — fills its grid cell
   * instead of the fixed carousel width, with a permanent soft glow so it
   * still reads as a premium card rather than a plain thumbnail.
   */
  compact?: boolean;
  /** When provided, the play button uses the full collection as the queue instead of a single-song fallback. */
  collectionSongs?: Song[];
  collectionIndex?: number;
  queueSource?: QueueSource;
  navigationSource?: NavigationSource;
}

/** Reusable album card with 3D lift, image zoom and an animated play control. */
function SongCardComponent({
  song,
  compact = false,
  collectionSongs,
  collectionIndex,
  queueSource,
  navigationSource,
}: Props) {
  const {
    current,
    isPlaying,
    queueSource: activeQueueSource,
    play,
    playFromCollection,
    toggle,
  } = usePlayer();
  const { settings } = useSettings();

  const isCurrent = current?.id === song.id;
  const playingNow = isCurrent && isPlaying;
  const isExplicit = isSongExplicit(song);
  const isBlocked = !settings.allowExplicitContent && isExplicit;

  const isSameCollection =
    activeQueueSource?.type === queueSource?.type && activeQueueSource?.id === queueSource?.id;

  const startFromCollection = () => {
    if (isBlocked) {
      toast.info("Explicit content is disabled in your Settings.");
      return;
    }
    if (collectionSongs && collectionSongs.length > 0 && queueSource) {
      const safeIndex =
        collectionIndex !== undefined && collectionIndex >= 0
          ? collectionIndex
          : collectionSongs.findIndex((item) => item.id === song.id);

      playFromCollection(
        collectionSongs,
        safeIndex >= 0 ? safeIndex : 0,
        queueSource,
        navigationSource,
      );

      return;
    }

    play(song, navigationSource);
  };

  const handlePlay = () => {
    if (isBlocked) {
      toast.info("Explicit content is disabled in your Settings.");
      return;
    }
    /*
     * একই song একই collection থেকে click হলে শুধু play/pause হবে।
     *
     * একই song অন্য collection থেকে click হলে নতুন collection queue
     * activate হবে।
     *
     * Example:
     * Trending → Baarish Mein Phir
     * তারপর Soft Hindi Vibes → Baarish Mein Phir
     *
     * দ্বিতীয় click-এ queue Soft Hindi Vibes হবে।
     */
    if (isCurrent && isSameCollection) {
      toggle();
      return;
    }

    startFromCollection();
  };

  /*
   * Card body click:
   * - যদি এই song ইতিমধ্যে এই collection থেকে active/playing থাকে, তাহলে
   *   Link স্বাভাবিকভাবে navigate করবে (Song Details page খুলবে) —
   *   song-list-row.tsx-এর মতোই two-step pattern।
   * - অন্য যেকোনো ক্ষেত্রে (নতুন song select করা) navigation বাতিল করে
   *   শুধু playback switch হবে, কোনো route change/remount ছাড়াই —
   *   এটাই দ্রুত, flash-free song switching নিশ্চিত করে।
   */
  const { recordPlayerSource } = useNavigationHistory();

  const handleCardNavigate = (event: React.MouseEvent) => {
    if (isBlocked) {
      event.preventDefault();
      toast.info("Explicit content is disabled in your Settings.");
      return;
    }
    recordPlayerSource();
    if (isCurrent && isSameCollection) {
      return;
    }
    event.preventDefault();
    startFromCollection();
  };

  const handlePointerMove = (event: React.MouseEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--mx", `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty("--my", `${event.clientY - bounds.top}px`);
  };

  return (
    <motion.article
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 450, damping: 25, mass: 0.8 }}
      className={cn(
        "group relative rounded-2xl border border-white/[0.06] bg-card/90 p-2 shadow-lg transition-all hover:border-white/[0.14] sm:rounded-3xl sm:p-3 active:opacity-90",
        compact ? "w-full" : "shrink-0",
        !compact &&
          "w-[calc((100vw-2.25rem)/3)] min-w-[104px] max-w-[128px] sm:w-48 md:w-52 lg:w-48 xl:w-52 2xl:w-56",
        isBlocked && "opacity-60 grayscale-[30%]",
      )}
    >
      <Link
        to="/song/$songId"
        params={{ songId: song.id }}
        preload="intent"
        onClick={handleCardNavigate}
        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${song.title} by ${song.artist}`}
      >
        <div className="relative overflow-hidden rounded-xl sm:rounded-2xl bg-[#182227]">
          <SongCoverImage
            src={song.cover}
            alt={`${song.album} album artwork`}
            width={800}
            height={800}
            loading="eager"
            decoding="auto"
            className="aspect-square w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />

          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-60 transition-opacity group-hover:opacity-80" />

          {song.trending && (
            <span
              className={cn(
                "absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full bg-primary font-semibold text-primary-foreground sm:left-2.5 sm:top-2.5",
                compact
                  ? "px-1.5 py-0.5 text-[9px]"
                  : "px-1.5 py-0.5 text-[9px] sm:px-2 sm:py-0.5 sm:text-[10px]",
              )}
            >
              <Flame className={compact ? "size-2.5" : "size-2.5 sm:size-3"} />
              <span className="hidden xs:inline">Trending</span>
            </span>
          )}

          {playingNow && (
            <span className="absolute right-1.5 top-1.5 rounded-full bg-black/80 px-1.5 py-1 sm:right-2.5 sm:top-2.5 sm:px-2 sm:py-1">
              <Equalizer />
            </span>
          )}

          <motion.button
            type="button"
            aria-label={playingNow ? `Pause ${song.title}` : `Play ${song.title}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handlePlay();
            }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            className={cn(
              "absolute bottom-2 right-2 sm:bottom-2.5 sm:right-2.5 flex items-center justify-center rounded-full transition-all duration-200 cursor-pointer z-10",
              "bg-[#2ee0b5] text-[#0d1617] shadow-md shadow-teal-500/25",
              playingNow
                ? "opacity-100 scale-100 shadow-[0_0_16px_rgba(46,224,181,0.6)]"
                : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:scale-105 active:scale-95",
              compact ? "size-7" : "size-7 xs:size-8 sm:size-9 md:size-10",
            )}
          >
            {playingNow ? (
              <Pause
                className={
                  compact ? "size-3.5 fill-current" : "size-3.5 sm:size-4 md:size-4.5 fill-current"
                }
              />
            ) : (
              <Play
                className={cn(
                  "fill-current translate-x-0.5",
                  compact ? "size-3.5" : "size-3.5 sm:size-4 md:size-4.5",
                )}
              />
            )}
          </motion.button>
        </div>

        <div className="mt-2 space-y-0.5 px-0.5 sm:mt-2.5 sm:space-y-1">
          <h3
            className={cn(
              "flex items-center gap-1 truncate font-bold tracking-tight text-foreground transition-colors group-hover:text-primary",
              compact ? "text-[11px]" : "text-xs sm:text-sm",
            )}
          >
            <span className="truncate">{song.title}</span>
            {isExplicit && (
              <span className="shrink-0 rounded bg-white/10 px-1 py-0.2 text-[9px] font-bold text-zinc-400">
                E
              </span>
            )}
          </h3>

          <p
            className={cn(
              "truncate text-muted-foreground",
              compact ? "text-[10px]" : "text-xs sm:text-xs",
            )}
          >
            {song.artist}
          </p>

          <div className="flex items-center justify-between pt-0.5">
            <p
              className={cn(
                "text-muted-foreground/70",
                compact ? "text-[9px]" : "text-[10px] sm:text-xs",
              )}
            >
              {formatTime(song.duration)}
            </p>

            <button
              type="button"
              aria-label={`More options for ${song.title}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className="-mr-0.5 grid h-5 w-5 place-items-center rounded-full text-muted-foreground/60 transition-colors hover:text-primary"
            >
              <MoreVertical className={compact ? "size-3" : "size-3 sm:size-3.5"} />
            </button>
          </div>
        </div>
      </Link>
    </motion.article>
  );
}

export const SongCard = memo(SongCardComponent);
