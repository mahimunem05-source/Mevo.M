import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { Clock, LoaderCircle, Search, X, Plus } from "lucide-react";
import { formatTime, searchSongs as searchStaticSongs, type Song } from "@/data/songs";
import { searchSongs as searchDatabaseSongs } from "@/services/songService";
import { databaseSongToPlayerSong, mergePlayerSongs } from "@/lib/song-adapter";
import { usePlayer } from "@/lib/player-context";
import { useNavigationHistory } from "@/lib/navigation-history";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";
import { SongCoverImage } from "./song-cover-image";

const RECENT_SEARCHES_KEY = "recent_searches";
const MAX_RECENT_SEARCHES = 8;

function getStoredRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStoredRecentSearch(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed || typeof window === "undefined") return getStoredRecentSearches();
  try {
    const existing = getStoredRecentSearches();
    const updated = [
      trimmed,
      ...existing.filter((item) => item.toLowerCase() !== trimmed.toLowerCase()),
    ].slice(0, MAX_RECENT_SEARCHES);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.error("Could not save recent search:", e);
    return getStoredRecentSearches();
  }
}

function deleteStoredRecentSearch(query: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const existing = getStoredRecentSearches();
    const updated = existing.filter((item) => item.toLowerCase() !== query.toLowerCase());
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

function clearAllStoredRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    /* ignore */
  }
  return [];
}

/**
 * Glassmorphism live search with a 250 ms database debounce, recent search history,
 * and full keyboard navigation (Up / Down / Enter / Escape).
 */
export function LiveSearch({ variant = "hero" }: { variant?: "hero" | "navbar" | "compact" }) {
  const navbar = variant === "navbar";
  const compact = variant === "compact";
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<Song[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { play } = usePlayer();
  const { t } = useTranslation();
  const { recordPlayerSource } = useNavigationHistory();

  // Load recent searches on client mount
  useEffect(() => {
    setRecentSearches(getStoredRecentSearches());
  }, []);

  useEffect(() => {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      setResults([]);
      setActive(0);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);

    const timerId = window.setTimeout(() => {
      void (async () => {
        try {
          const databaseResults = await searchDatabaseSongs(normalizedQuery, 6);

          if (cancelled) {
            return;
          }

          const uploadedSongs = databaseResults.map((song) => databaseSongToPlayerSong(song));
          const demoSongs = searchStaticSongs(normalizedQuery, 6);

          setResults(mergePlayerSongs(uploadedSongs, demoSongs).slice(0, 6));
          setActive(0);
        } catch (error) {
          if (!cancelled) {
            console.error("Could not search uploaded songs:", error);
            setResults(searchStaticSongs(normalizedQuery, 6));
            setActive(0);
          }
        } finally {
          if (!cancelled) {
            setIsSearching(false);
          }
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [query]);

  // Click outside to close dropdown
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Keyboard shortcut '/' to focus
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "/" && document.activeElement !== inputRef.current) {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const select = (song: Song) => {
    const savedTerm = query.trim() || song.title;
    if (savedTerm) {
      setRecentSearches(saveStoredRecentSearch(savedTerm));
    }
    play(song);
    setOpen(false);
    setQuery("");
    recordPlayerSource("/search");
    const isAlreadyOnSongPage =
      typeof window !== "undefined" && window.location.pathname.startsWith("/song/");
    void navigate({
      to: "/song/$songId",
      params: { songId: song.id },
      replace: isAlreadyOnSongPage,
    });
  };

  const handleRequestSong = (songTitle: string) => {
    setOpen(false);
    const trimmed = songTitle.trim();
    if (trimmed) {
      setRecentSearches(saveStoredRecentSearch(trimmed));
    }
    void navigate({
      to: "/contact",
      search: {
        song: trimmed,
      },
    });
  };

  const handleSelectRecentQuery = (term: string) => {
    setQuery(term);
    setRecentSearches(saveStoredRecentSearch(term));
    setOpen(true);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (event.key === "Enter") {
      if (results.length > 0 && results[active]) {
        event.preventDefault();
        select(results[active]);
        return;
      }
      if (query.trim()) {
        event.preventDefault();
        handleRequestSong(query.trim());
        return;
      }
    }

    if (results.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + results.length) % results.length);
    }
  };

  const showSearchResults = open && query.trim().length > 0;
  const showRecentSearches = open && query.trim().length === 0 && recentSearches.length > 0;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative",
        compact ? "w-28 xs:w-36 sm:w-48" : "w-full",
        !compact && (navbar ? "max-w-md" : "max-w-xl"),
      )}
    >
      <div
        className={cn(
          "search-glass flex items-center rounded-full glass transition-shadow focus-within:glow-ring",
          compact ? "gap-2 px-4 py-2" : navbar ? "gap-2 px-4 py-2" : "gap-3 px-5 py-4",
        )}
      >
        <Search
          className={cn(
            "shrink-0 text-primary",
            compact ? "size-3.5" : navbar ? "size-4" : "size-5",
          )}
        />
        <input
          ref={inputRef}
          value={query}
          role="combobox"
          aria-expanded={showSearchResults || showRecentSearches}
          aria-controls="search-results"
          aria-label="Search songs, albums or artists"
          placeholder={
            compact
              ? t("nav.search", "Search...")
              : navbar
                ? t("nav.search", "Search music...")
                : t("nav.searchPlaceholder", "Search songs, albums or artists...")
          }
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setRecentSearches(getStoredRecentSearches());
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground",
            compact ? "text-xs" : navbar ? "text-sm" : "text-base",
          )}
        />

        {isSearching ? (
          <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
        ) : (
          !compact && (
            <kbd className="hidden rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground sm:block">
              /
            </kbd>
          )
        )}
      </div>

      <AnimatePresence>
        {/* 1. RECENT SEARCHES DROPDOWN (When focused and empty) */}
        {showRecentSearches && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "z-50 overflow-hidden rounded-2xl sm:rounded-3xl glass-strong p-2 shadow-2xl backdrop-blur-2xl bg-[#12191D]/95 border border-white/10",
              compact
                ? "fixed inset-x-4 top-[3.75rem] sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+0.5rem)] sm:w-88 sm:max-w-sm"
                : "absolute left-0 right-0 top-[calc(100%+0.75rem)]",
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
              <span className="text-[11px] font-bold uppercase tracking-wider text-teal-400">
                {t("search.recentSearches", "Recent Searches")}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setRecentSearches(clearAllStoredRecentSearches());
                }}
                className="text-[11px] font-semibold text-white/50 hover:text-red-400 transition-colors cursor-pointer"
              >
                {t("search.clearAll", "Clear All")}
              </button>
            </div>

            {/* List */}
            <ul className="py-1 space-y-0.5 max-h-60 overflow-y-auto">
              {recentSearches.map((term) => (
                <li
                  key={term}
                  className="group flex items-center justify-between rounded-xl px-3 py-2 text-xs sm:text-sm text-white/80 hover:bg-white/[0.08] hover:text-white transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => handleSelectRecentQuery(term)}
                    className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <Clock className="size-3.5 text-white/40 group-hover:text-teal-400 shrink-0 transition-colors" />
                    <span className="truncate">{term}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${term}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRecentSearches(deleteStoredRecentSearch(term));
                    }}
                    className="ml-2 p-1 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer shrink-0"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}

        {/* 2. LIVE SEARCH RESULTS DROPDOWN */}
        {showSearchResults && (
          <motion.ul
            id="search-results"
            role="listbox"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "z-50 max-h-[60vh] sm:max-h-96 overflow-y-auto rounded-2xl sm:rounded-3xl glass-strong p-1.5 sm:p-2 shadow-2xl backdrop-blur-2xl bg-[#12191D]/95 border border-white/10",
              compact
                ? "fixed inset-x-4 top-[3.75rem] sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+0.5rem)] sm:w-88 sm:max-w-sm"
                : "absolute left-0 right-0 top-[calc(100%+0.75rem)]",
            )}
          >
            {!isSearching && results.length === 0 && (
              <li className="p-3 sm:p-4 text-center">
                <div className="flex flex-col items-center gap-2">
                  <p className="text-xs sm:text-sm text-white/60">
                    No tracks matched <span className="font-semibold text-white">“{query}”</span>.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleRequestSong(query)}
                    className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl sm:rounded-2xl border border-[#4FD1C5]/30 bg-[#4FD1C5]/10 hover:bg-[#4FD1C5]/20 p-2.5 sm:p-3 text-xs sm:text-sm font-semibold text-teal-400 hover:text-teal-300 transition-all duration-200 cursor-pointer shadow-[0_0_15px_rgba(79,209,197,0.12)] hover:shadow-[0_0_20px_rgba(79,209,197,0.22)] active:scale-[0.99]"
                  >
                    <Plus className="size-4 shrink-0 text-teal-400" />
                    <span>Song not found? Contact MEVO to add a new song</span>
                  </button>
                </div>
              </li>
            )}

            {results.map((song, index) => (
              <li key={song.id} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => select(song)}
                  className={cn(
                    "flex w-full items-center gap-3 sm:gap-3.5 rounded-xl sm:rounded-2xl p-2 sm:p-2.5 text-left transition-all duration-150 cursor-pointer",
                    index === active
                      ? "bg-white/10 text-teal-400"
                      : "text-white/80 hover:bg-white/[0.06] hover:text-white",
                  )}
                >
                  <div className="relative size-10 sm:size-11 shrink-0 overflow-hidden rounded-lg sm:rounded-xl border border-white/10">
                    <SongCoverImage
                      src={song.cover}
                      alt=""
                      width={44}
                      height={44}
                      loading="eager"
                      decoding="auto"
                      className="size-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-xs sm:text-sm font-semibold transition-colors",
                        index === active ? "text-teal-400" : "text-white",
                      )}
                    >
                      {song.title}
                    </span>
                    <span className="block truncate text-[11px] sm:text-xs text-white/50 mt-0.5">
                      {song.artist} {song.category ? `· ${song.category}` : ""}
                    </span>
                  </div>
                  <span className="text-[11px] sm:text-xs tabular-nums text-white/40 shrink-0 ml-1">
                    {formatTime(song.duration)}
                  </span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
