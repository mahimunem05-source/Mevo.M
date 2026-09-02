import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  songs as staticSongs,
  isSongExplicit,
  type NavigationSource,
  type QueueSource,
  type Song,
} from "@/data/songs";
import { getSongs, incrementPlayCount } from "@/services/songService";
import { recordPlay, recordSongPlayedTimestamp } from "@/services/listeningHistoryService";
import { subscribeToRealtimeChanges } from "@/lib/realtime-helper";
import { databaseSongToPlayerSong, mergePlayerSongs } from "@/lib/song-adapter";
import { playbackEvents } from "@/lib/playback-events";
import { startEngagementTracking } from "@/lib/ranking/engagement-tracker";
import { createUniversalSmartQueue, generateDiscoveryQueue } from "@/lib/ranking/queue-engine";
import { useSettings } from "@/context/SettingsContext";

type RepeatMode = "off" | "all" | "one";

interface PlaybackSession {
  originalQueue: Song[];
  queue: Song[];
  currentIndex: number;
  queueSource: QueueSource | null;
  navigationSource: NavigationSource | null;
  history: string[];
}

const EMPTY_SESSION: PlaybackSession = {
  originalQueue: [],
  queue: [],
  currentIndex: -1,
  queueSource: null,
  navigationSource: null,
  history: [],
};

interface PlayerState {
  current: Song | null;
  catalogue: Song[];
  originalQueue: Song[];
  queue: Song[];
  queueIds: string[];
  currentIndex: number;
  queueSource: QueueSource | null;
  navigationSource: NavigationSource | null;
  history: string[];
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  likes: string[];
  recent: Song[];
  play: (song: Song, navigationSource?: NavigationSource) => void;
  playFromCollection: (
    songs: Song[],
    selectedIndex: number,
    source: QueueSource,
    navigationSource?: NavigationSource,
  ) => void;
  playQueueIndex: (index: number) => void;
  ensureQueueContainsSong: (song: Song) => void;
  /** Insert a song immediately after the currently playing track. */
  playNext: (song: Song) => void;
  /** Append a song to the end of the queue. */
  addToQueue: (song: Song) => void;
  /** Remove a song from the queue by its position. Adjusts playback if it was the current track. */
  removeFromQueue: (index: number) => void;
  /** Clear every queued track except the one currently playing. */
  clearQueue: () => void;
  /** Move a queued track from one position to another (drag-to-reorder). */
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  toggleLike: (id: string) => void;
  isLiked: (id: string) => boolean;
  /** Bottom player visibility — hidden on first visit, shown once a song plays. */
  playerVisible: boolean;
  hidePlayer: () => void;
  /** True while the current track is loading/stalled and audible playback has paused to buffer. */
  isBuffering: boolean;
  /** Most recent unrecoverable playback error, if any (cleared on next successful play). */
  playbackError: string | null;
  /** Whether the queue auto-extends with recommendations when it ends (default on). */
  autoplayEnabled: boolean;
  toggleAutoplay: () => void;
}

const PlayerContext = createContext<PlayerState | null>(null);

/**
 * currentTime/duration change up to 4x/sec during playback. They're kept
 * out of PlayerState and in their own context so that progress bars
 * (e.g. SeekBar) subscribe without forcing every other usePlayer() consumer
 * across the app to re-render on every tick.
 */
interface PlayerProgressState {
  progress: number;
  duration: number;
}
const PlayerProgressContext = createContext<PlayerProgressState>({
  progress: 0,
  duration: 0,
});

const LIKES_KEY = "mahi-music:likes";
const PLAYER_STORAGE_KEY = "mahi-music-playback-session-v3";
const PLAYER_DISMISSED_KEY = "mahi-music:player-dismissed";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface StoredPlaybackSession {
  originalQueueIds: string[];
  queueIds: string[];
  currentSongId: string | null;
  queueSource: QueueSource | null;
  navigationSource: NavigationSource | null;
  history: string[];
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  autoplayEnabled: boolean;
}

function readStoredLikes(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LIKES_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function isQueueSource(value: unknown): value is QueueSource {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.type === "string" &&
    typeof candidate.id === "string" &&
    typeof candidate.title === "string"
  );
}

function isNavigationSource(value: unknown): value is NavigationSource {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    isQueueSource(value) &&
    typeof candidate.pathname === "string" &&
    typeof candidate.label === "string"
  );
}

function readStoredSession(): StoredPlaybackSession | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PLAYER_STORAGE_KEY) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as Record<string, unknown>;
    if (!Array.isArray(value.queueIds) || !Array.isArray(value.originalQueueIds)) {
      return null;
    }
    const queueIds = value.queueIds.filter((id): id is string => typeof id === "string");
    const originalQueueIds = value.originalQueueIds.filter(
      (id): id is string => typeof id === "string",
    );
    if (queueIds.length === 0 || originalQueueIds.length === 0) return null;

    const repeat: RepeatMode =
      value.repeat === "all" || value.repeat === "one" ? value.repeat : "off";

    return {
      queueIds,
      originalQueueIds,
      currentSongId: typeof value.currentSongId === "string" ? value.currentSongId : null,
      queueSource: isQueueSource(value.queueSource) ? value.queueSource : null,
      navigationSource: isNavigationSource(value.navigationSource) ? value.navigationSource : null,
      history: Array.isArray(value.history)
        ? value.history.filter((id): id is string => typeof id === "string").slice(-100)
        : [],
      shuffle: value.shuffle === true,
      repeat,
      volume:
        typeof value.volume === "number" && Number.isFinite(value.volume)
          ? Math.min(Math.max(value.volume, 0), 1)
          : 0.8,
      autoplayEnabled: value.autoplayEnabled !== false,
    };
  } catch {
    return null;
  }
}

function dedupeSongs(songs: Song[]): Song[] {
  const seen = new Set<string>();
  return songs.filter((song) => {
    if (seen.has(song.id)) return false;
    seen.add(song.id);
    return true;
  });
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { settings, updateSetting } = useSettings();

  // 1. Single Dedicated HTMLAudioElement Reference
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [catalogue, setCatalogue] = useState<Song[]>([...staticSongs]);
  const [session, setSession] = useState<PlaybackSession>(EMPTY_SESSION);
  const [isPlaying, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [likes, setLikes] = useState<string[]>([]);
  const [recent, setRecent] = useState<Song[]>([]);
  const [isBuffering, setIsBuffering] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const pendingRestoreRef = useRef<StoredPlaybackSession | null>(null);
  const loadTokenRef = useRef(0);
  const shufflePlayedIdsRef = useRef<Set<string>>(new Set());
  const lastTimeEventRef = useRef(0);

  // Bottom player visibility
  const [playerVisible, setPlayerVisible] = useState(false);

  const autoplayEnabled = settings.autoplay;
  const toggleAutoplay = useCallback(() => {
    const next = !settings.autoplay;
    updateSetting("autoplay", next);
    playbackEvents.emit("AUTOPLAY", { enabled: next });
  }, [settings.autoplay, updateSetting]);

  const current = session.currentIndex >= 0 ? (session.queue[session.currentIndex] ?? null) : null;

  // Anonymous engagement tracking
  useEffect(() => startEngagementTracking(), []);

  // Restore stored session on mount
  useEffect(() => {
    pendingRestoreRef.current = readStoredSession();
    const stored = pendingRestoreRef.current;
    if (stored) {
      setShuffle(stored.shuffle);
      setRepeat(stored.repeat);
      setVolumeState(stored.volume);
    }
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(PLAYER_DISMISSED_KEY) === "1";
    } catch {
      dismissed = false;
    }
    if (stored && !dismissed) setPlayerVisible(true);
    setLikes(readStoredLikes());
  }, []);

  const hidePlayer = useCallback(() => {
    setPlayerVisible(false);
    try {
      window.localStorage.setItem(PLAYER_DISMISSED_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  // Fetch / Sync Catalogue
  useEffect(() => {
    let isMounted = true;

    async function refreshCatalogue() {
      try {
        const uploadedSongs = await getSongs();
        if (!isMounted) return;

        const nextCatalogue = mergePlayerSongs(
          uploadedSongs.map((song) => databaseSongToPlayerSong(song)),
          staticSongs,
        );
        setCatalogue(nextCatalogue);
        setRecent((previous) =>
          previous.map(
            (song) => nextCatalogue.find((candidate) => candidate.id === song.id) ?? song,
          ),
        );

        const stored = pendingRestoreRef.current;
        if (stored) {
          pendingRestoreRef.current = null;
          const mapIds = (ids: string[]) =>
            ids
              .map((id) => nextCatalogue.find((song) => song.id === id))
              .filter((song): song is Song => Boolean(song));
          const originalQueue = mapIds(stored.originalQueueIds);
          const queue = mapIds(stored.queueIds);
          if (originalQueue.length > 0 && queue.length > 0) {
            const currentIndex = stored.currentSongId
              ? queue.findIndex((song) => song.id === stored.currentSongId)
              : 0;
            setSession({
              originalQueue,
              queue,
              currentIndex: currentIndex >= 0 ? currentIndex : 0,
              queueSource: stored.queueSource,
              navigationSource: stored.navigationSource,
              history: stored.history,
            });
            return;
          }
        }

        setSession((previous) => {
          if (previous.queue.length === 0) return previous;
          const refresh = (songs: Song[]) =>
            songs.map(
              (song) => nextCatalogue.find((candidate) => candidate.id === song.id) ?? song,
            );
          return {
            ...previous,
            queue: refresh(previous.queue),
            originalQueue: refresh(previous.originalQueue),
          };
        });
      } catch (error) {
        console.error("Could not refresh the player catalogue:", error);
      }
    }

    void refreshCatalogue();

    const cleanup = subscribeToRealtimeChanges("player-catalogue-songs", [
      {
        table: "songs",
        callback: () => void refreshCatalogue(),
      },
    ]);

    return () => {
      isMounted = false;
      cleanup();
    };
  }, []);

  // Persist playback session to localStorage
  useEffect(() => {
    try {
      if (session.queue.length === 0) {
        window.localStorage.removeItem(PLAYER_STORAGE_KEY);
        return;
      }
      const payload: StoredPlaybackSession = {
        originalQueueIds: session.originalQueue.map((song) => song.id),
        queueIds: session.queue.map((song) => song.id),
        currentSongId: current?.id ?? null,
        queueSource: session.queueSource,
        navigationSource: session.navigationSource,
        history: session.history,
        shuffle,
        repeat,
        volume,
        autoplayEnabled,
      };
      window.localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error("Could not persist playback session:", error);
    }
  }, [session, current?.id, shuffle, repeat, volume, autoplayEnabled]);

  // Synchronize volume & mute state directly to the single audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const targetVolume = muted ? 0 : Math.max(0, Math.min(1, volume));
    audio.volume = targetVolume;
    audio.muted = muted;
  }, [volume, muted]);

  // Safe playback trigger
  const executePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    // Explicitly verify audio volume & mute state prior to play
    audio.muted = muted;
    audio.volume = muted ? 0 : Math.max(0, Math.min(1, volume));

    try {
      await audio.play();
    } catch (error: unknown) {
      const err = error as { name?: string; message?: string };
      if (err.name === "AbortError") {
        // Normal when user skips quickly between tracks; safely ignore
        return;
      }
      console.warn("[Mahi Music Audio] Playback execution notice:", error);
      setPlaying(false);
    }
  }, [muted, volume]);

  const activateSong = useCallback(
    (song: Song, previousSong?: Song | null) => {
      // Check explicit content restriction
      if (!settings.allowExplicitContent && isSongExplicit(song)) {
        setPlaying(false);
        const message = `Explicit content is disabled in your Settings.`;
        setPlaybackError(message);
        playbackEvents.emit("ERROR", {
          message,
          songId: song.id,
          recoverable: true,
        });
        return;
      }

      setPlaying(true);
      setProgress(0);
      setPlaybackError(null);
      setPlayerVisible(true);

      try {
        window.localStorage.removeItem(PLAYER_DISMISSED_KEY);
      } catch {
        /* ignore */
      }

      // Log listening activity
      const shouldLogActivity = settings.showListeningActivity && !settings.privateSession;
      if (shouldLogActivity) {
        setRecent((previous) =>
          [song, ...previous.filter((item) => item.id !== song.id)].slice(0, 8),
        );
        void recordPlay(song.id);
        recordSongPlayedTimestamp(song.id);
        if (UUID_PATTERN.test(song.id)) {
          void incrementPlayCount(song.id).catch((error) =>
            console.error("Could not increment play count:", error),
          );
        }
      }

      playbackEvents.emit("SONG_CHANGE", { song, previous: previousSong ?? null });
      playbackEvents.emit("PLAY", { song });
    },
    [settings.allowExplicitContent, settings.showListeningActivity, settings.privateSession],
  );

  const playFromCollection = useCallback(
    (
      songsList: Song[],
      selectedIndex: number,
      source: QueueSource,
      navigationSource?: NavigationSource,
    ) => {
      if (!songsList || songsList.length === 0) return;
      const selectedSong = songsList[selectedIndex] ?? songsList[0];

      const smartQueue = createUniversalSmartQueue({
        currentTrack: selectedSong,
        contextSongs: songsList,
        catalogue,
        queueSource: source,
        navigationSource,
      });

      shufflePlayedIdsRef.current = new Set();
      const previousSong = current;
      setSession({
        originalQueue: smartQueue.originalQueue,
        queue: smartQueue.queue,
        currentIndex: smartQueue.currentIndex,
        queueSource: smartQueue.queueSource,
        navigationSource: smartQueue.navigationSource,
        history: [],
      });
      activateSong(smartQueue.queue[smartQueue.currentIndex], previousSong);
      playbackEvents.emit("QUEUE_CHANGE", {
        queue: smartQueue.queue,
        source: smartQueue.queueSource,
        reason: "play",
      });
    },
    [activateSong, catalogue, current],
  );

  const play = useCallback(
    (song: Song, navigationSource?: NavigationSource) => {
      const albumSongs = catalogue.filter(
        (item) => item.album === song.album && item.album.trim().length > 0,
      );
      const artistSongs = catalogue.filter((item) => item.artist === song.artist);
      const sectionSongs = catalogue.filter((item) => item.section === song.section);

      const collection =
        albumSongs.length > 1
          ? albumSongs
          : artistSongs.length > 1
            ? artistSongs
            : sectionSongs.length > 0
              ? sectionSongs
              : [song];
      const type: QueueSource["type"] =
        albumSongs.length > 1 ? "album" : artistSongs.length > 1 ? "artist" : "section";
      const id = type === "album" ? song.album : type === "artist" ? song.artist : song.section;
      const title = type === "album" ? song.album : type === "artist" ? song.artist : song.category;
      const selectedIndex = collection.findIndex((item) => item.id === song.id);
      playFromCollection(
        collection,
        Math.max(selectedIndex, 0),
        { type, id, title },
        navigationSource,
      );
    },
    [catalogue, playFromCollection],
  );

  const playQueueIndex = useCallback(
    (index: number) => {
      setSession((previous) => {
        const song = previous.queue[index];
        if (!song) return previous;
        const previousSong = previous.queue[previous.currentIndex];
        activateSong(song, previousSong);
        return {
          ...previous,
          currentIndex: index,
          history: previousSong
            ? [...previous.history, previousSong.id].slice(-100)
            : previous.history,
        };
      });
    },
    [activateSong],
  );

  const ensureQueueContainsSong = useCallback(
    (song: Song) => {
      setSession((previous) => {
        if (previous.queue.some((item) => item.id === song.id)) return previous;
        if (previous.queue.length > 0) return previous;

        const albumSongs = catalogue.filter(
          (item) => item.album === song.album && item.album.trim().length > 0,
        );
        const artistSongs = catalogue.filter((item) => item.artist === song.artist);
        const sectionSongs = catalogue.filter((item) => item.section === song.section);
        const collection =
          albumSongs.length > 1
            ? albumSongs
            : artistSongs.length > 1
              ? artistSongs
              : sectionSongs.length > 0
                ? sectionSongs
                : [song];
        const type: QueueSource["type"] =
          albumSongs.length > 1 ? "album" : artistSongs.length > 1 ? "artist" : "section";
        const id = type === "album" ? song.album : type === "artist" ? song.artist : song.section;
        const title =
          type === "album" ? song.album : type === "artist" ? song.artist : song.category;

        const smartQueue = createUniversalSmartQueue({
          currentTrack: song,
          contextSongs: collection,
          catalogue,
          queueSource: { type, id, title },
          navigationSource: null,
        });

        return {
          originalQueue: smartQueue.originalQueue,
          queue: smartQueue.queue,
          currentIndex: smartQueue.currentIndex,
          queueSource: smartQueue.queueSource,
          navigationSource: smartQueue.navigationSource,
          history: [],
        };
      });
    },
    [catalogue],
  );

  const playNext = useCallback((song: Song) => {
    setSession((previous) => {
      if (previous.currentIndex < 0) return previous;
      const withoutSong = previous.queue.filter((item) => item.id !== song.id);
      const insertAt = Math.min(previous.currentIndex + 1, withoutSong.length);
      const queue = [...withoutSong.slice(0, insertAt), song, ...withoutSong.slice(insertAt)];
      const currentSongId = previous.queue[previous.currentIndex]?.id;
      const currentIndex = queue.findIndex((item) => item.id === currentSongId);
      const originalQueue = dedupeSongs([...previous.originalQueue, song]);
      playbackEvents.emit("QUEUE_CHANGE", {
        queue,
        source: previous.queueSource,
        reason: "play-next",
      });
      return { ...previous, queue, originalQueue, currentIndex: Math.max(currentIndex, 0) };
    });
  }, []);

  const addToQueue = useCallback((song: Song) => {
    setSession((previous) => {
      if (previous.queue.some((item) => item.id === song.id)) return previous;
      const queue = [...previous.queue, song];
      const originalQueue = dedupeSongs([...previous.originalQueue, song]);
      playbackEvents.emit("QUEUE_CHANGE", {
        queue,
        source: previous.queueSource,
        reason: "add-to-queue",
      });
      return { ...previous, queue, originalQueue };
    });
  }, []);

  const removeFromQueue = useCallback(
    (index: number) => {
      setSession((previous) => {
        const target = previous.queue[index];
        if (!target) return previous;
        const queue = previous.queue.filter((_, i) => i !== index);
        const originalQueue = previous.originalQueue.filter((item) => item.id !== target.id);
        playbackEvents.emit("QUEUE_CHANGE", {
          queue,
          source: previous.queueSource,
          reason: "remove",
        });

        if (index > previous.currentIndex) {
          return { ...previous, queue, originalQueue };
        }
        if (index < previous.currentIndex) {
          return { ...previous, queue, originalQueue, currentIndex: previous.currentIndex - 1 };
        }
        if (queue.length === 0) {
          setPlaying(false);
          return { ...previous, queue, originalQueue, currentIndex: -1 };
        }
        const nextIndex = Math.min(index, queue.length - 1);
        activateSong(queue[nextIndex], target);
        return { ...previous, queue, originalQueue, currentIndex: nextIndex };
      });
    },
    [activateSong],
  );

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    setSession((previous) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= previous.queue.length ||
        toIndex >= previous.queue.length
      ) {
        return previous;
      }
      const playingId = previous.queue[previous.currentIndex]?.id;
      const queue = [...previous.queue];
      const [moved] = queue.splice(fromIndex, 1);
      queue.splice(toIndex, 0, moved);
      const currentIndex = playingId
        ? queue.findIndex((song) => song.id === playingId)
        : previous.currentIndex;
      playbackEvents.emit("QUEUE_CHANGE", {
        queue,
        source: previous.queueSource,
        reason: "reorder",
      });
      return { ...previous, queue, currentIndex: Math.max(currentIndex, 0) };
    });
  }, []);

  const clearQueue = useCallback(() => {
    setSession((previous) => {
      const currentSong = previous.queue[previous.currentIndex];
      const queue = currentSong ? [currentSong] : [];
      playbackEvents.emit("QUEUE_CHANGE", { queue, source: previous.queueSource, reason: "clear" });
      return { ...previous, queue, originalQueue: queue, currentIndex: queue.length > 0 ? 0 : -1 };
    });
  }, []);

  const step = useCallback(
    (direction: 1 | -1, auto = false) => {
      setSession((previous) => {
        if (previous.queue.length === 0 || previous.currentIndex < 0) return previous;
        const currentSong = previous.queue[previous.currentIndex];

        // Shuffle Mode Handling
        if (shuffle && currentSong) {
          if (direction === -1) {
            if (previous.history.length === 0) return previous;
            const previousId = previous.history[previous.history.length - 1];
            const previousSong =
              previous.queue.find((song) => song.id === previousId) ??
              catalogue.find((song) => song.id === previousId);
            if (!previousSong) {
              return { ...previous, history: previous.history.slice(0, -1) };
            }
            activateSong(previousSong, currentSong);
            playbackEvents.emit("PREVIOUS", { song: previousSong });
            const restoredIndex = previous.queue.findIndex((song) => song.id === previousSong.id);
            return {
              ...previous,
              currentIndex: restoredIndex >= 0 ? restoredIndex : previous.currentIndex,
              history: previous.history.slice(0, -1),
            };
          }

          let pool = previous.queue.filter(
            (song) => song.id !== currentSong.id && !shufflePlayedIdsRef.current.has(song.id),
          );
          let cycleReset = false;
          if (pool.length === 0) {
            pool = previous.queue.filter((song) => song.id !== currentSong.id);
            cycleReset = true;
          }

          const nextSong =
            pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : currentSong;
          if (nextSong.id === currentSong.id) return previous;

          shufflePlayedIdsRef.current = cycleReset
            ? new Set([nextSong.id])
            : new Set(shufflePlayedIdsRef.current).add(nextSong.id);

          activateSong(nextSong, currentSong);
          playbackEvents.emit("NEXT", { song: nextSong, auto });
          const nextIndex = previous.queue.findIndex((song) => song.id === nextSong.id);
          return {
            ...previous,
            currentIndex: nextIndex >= 0 ? nextIndex : previous.currentIndex,
            history: [...previous.history, currentSong.id].slice(-100),
          };
        }

        // Sequential Mode Handling
        const atEnd = previous.currentIndex === previous.queue.length - 1;
        const atStart = previous.currentIndex === 0;

        if (direction === 1 && atEnd && repeat === "off") {
          if (!autoplayEnabled) {
            setPlaying(false);
            playbackEvents.emit("QUEUE_ENDED", { autoplayed: false });
            return previous;
          }

          const currentTrack = previous.queue[previous.currentIndex];
          const discoveryTracks = generateDiscoveryQueue(
            currentTrack,
            previous.queue,
            catalogue,
            20,
          );

          if (discoveryTracks.length === 0) {
            setPlaying(false);
            playbackEvents.emit("QUEUE_ENDED", { autoplayed: false });
            return previous;
          }

          const queue = [...previous.queue, ...discoveryTracks];
          const nextIndex = previous.currentIndex + 1;
          const song = queue[nextIndex];
          activateSong(song, currentTrack);
          playbackEvents.emit("QUEUE_ENDED", { autoplayed: true });
          playbackEvents.emit("QUEUE_CHANGE", {
            queue,
            source: previous.queueSource,
            reason: "autoplay",
          });
          playbackEvents.emit("NEXT", { song, auto });
          return {
            ...previous,
            queue,
            currentIndex: nextIndex,
            history: currentTrack
              ? [...previous.history, currentTrack.id].slice(-100)
              : previous.history,
          };
        }

        if (repeat === "off" && direction === -1 && atStart) {
          setPlaying(false);
          return previous;
        }

        const nextIndex =
          (previous.currentIndex + direction + previous.queue.length) % previous.queue.length;
        const song = previous.queue[nextIndex];
        const previousSong = previous.queue[previous.currentIndex];
        if (song) activateSong(song, previousSong);
        playbackEvents.emit(direction === 1 ? "NEXT" : "PREVIOUS", { song, auto });
        return {
          ...previous,
          currentIndex: nextIndex,
          history: previousSong
            ? [...previous.history, previousSong.id].slice(-100)
            : previous.history,
        };
      });
    },
    [activateSong, catalogue, repeat, autoplayEnabled, shuffle],
  );

  const next = useCallback(() => step(1, false), [step]);
  const previous = useCallback(() => step(-1, false), [step]);

  const toggle = useCallback(() => {
    if (!current) {
      const first = catalogue[0];
      if (first) play(first);
      return;
    }
    setPlaying((value) => {
      const nextState = !value;
      playbackEvents.emit(
        nextState ? "PLAY" : "PAUSE",
        nextState ? { song: current } : { song: current },
      );
      return nextState;
    });
  }, [catalogue, current, play]);

  const toggleShuffle = useCallback(() => {
    setShuffle((enabled) => {
      const nextEnabled = !enabled;
      shufflePlayedIdsRef.current = new Set();
      playbackEvents.emit("SHUFFLE", { enabled: nextEnabled });
      return nextEnabled;
    });
  }, []);

  // Synchronize Audio Track Source & Playback State
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!current) {
      audio.pause();
      audio.removeAttribute("src");
      delete audio.dataset.songId;
      audio.load();
      setProgress(0);
      return;
    }

    if (!current.audio) {
      audio.pause();
      setPlaying(false);
      setPlaybackError(`No audio source available for "${current.title}".`);
      return;
    }

    const isNewTrack = audio.dataset.songId !== current.id;
    if (isNewTrack) {
      audio.dataset.songId = current.id;
      audio.pause();
      audio.src = current.audio;
      audio.currentTime = 0;
      setProgress(0);
      audio.load();
    }

    if (isPlaying) {
      void executePlay();
    } else {
      audio.pause();
    }

    // MediaSession API Sync for lock-screen & mobile media controls
    if (typeof window !== "undefined" && "mediaSession" in navigator) {
      if (current) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: current.title,
            artist: current.artist,
            album: current.album || "MEVO",
            artwork: [
              { src: current.cover, sizes: "96x96", type: "image/jpeg" },
              { src: current.cover, sizes: "128x128", type: "image/jpeg" },
              { src: current.cover, sizes: "192x192", type: "image/jpeg" },
              { src: current.cover, sizes: "256x256", type: "image/jpeg" },
              { src: current.cover, sizes: "384x384", type: "image/jpeg" },
              { src: current.cover, sizes: "512x512", type: "image/jpeg" },
            ],
          });
          navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
        } catch {
          // Ignore unsupported MediaSession attributes
        }
      } else {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
      }
    }
  }, [current, isPlaying, executePlay]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (audio && Number.isFinite(seconds)) {
      audio.currentTime = seconds;
    }
    setProgress(seconds);
    playbackEvents.emit("SEEK", { seconds });
  }, []);

  // Hook MediaSession Action Handlers
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return;

    const actionHandlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => setPlaying(true)],
      ["pause", () => setPlaying(false)],
      ["previoustrack", () => previous()],
      ["nexttrack", () => next()],
      [
        "seekto",
        (details) => {
          if (details.seekTime != null && Number.isFinite(details.seekTime)) {
            seek(details.seekTime);
          }
        },
      ],
    ];

    for (const [action, handler] of actionHandlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Ignore unsupported actions
      }
    }

    return () => {
      for (const [action] of actionHandlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  }, [next, previous, seek]);

  const setVolume = useCallback((nextVolume: number) => {
    const clamped = Math.max(0, Math.min(1, nextVolume));
    setVolumeState(clamped);
    if (clamped > 0) setMuted(false);
  }, []);

  const toggleMute = useCallback(() => setMuted((value) => !value), []);

  const cycleRepeat = useCallback(() => {
    setRepeat((value) => {
      const nextMode = value === "off" ? "all" : value === "all" ? "one" : "off";
      playbackEvents.emit("REPEAT", { mode: nextMode });
      return nextMode;
    });
  }, []);

  const toggleLike = useCallback((id: string) => {
    setLikes((previousLikes) => {
      const willLike = !previousLikes.includes(id);
      const nextLikes = willLike
        ? [...previousLikes, id]
        : previousLikes.filter((likedId) => likedId !== id);
      window.localStorage.setItem(LIKES_KEY, JSON.stringify(nextLikes));
      playbackEvents.emit(willLike ? "LIKE" : "UNLIKE", { id });
      return nextLikes;
    });
  }, []);

  const isLiked = useCallback((id: string) => likes.includes(id), [likes]);

  const value: PlayerState = useMemo(
    () => ({
      current,
      catalogue,
      originalQueue: session.originalQueue,
      queue: session.queue,
      queueIds: session.queue.map((song) => song.id),
      currentIndex: session.currentIndex,
      queueSource: session.queueSource,
      navigationSource: session.navigationSource,
      history: session.history,
      isPlaying,
      volume,
      muted,
      shuffle,
      repeat,
      likes,
      recent,
      play,
      playFromCollection,
      playQueueIndex,
      ensureQueueContainsSong,
      playNext,
      addToQueue,
      removeFromQueue,
      clearQueue,
      reorderQueue,
      toggle,
      next,
      previous,
      seek,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      toggleLike,
      isLiked,
      playerVisible,
      hidePlayer,
      isBuffering,
      playbackError,
      autoplayEnabled,
      toggleAutoplay,
    }),
    [
      current,
      catalogue,
      session,
      isPlaying,
      volume,
      muted,
      shuffle,
      repeat,
      likes,
      recent,
      play,
      playFromCollection,
      playQueueIndex,
      ensureQueueContainsSong,
      playNext,
      addToQueue,
      removeFromQueue,
      clearQueue,
      reorderQueue,
      toggle,
      next,
      previous,
      seek,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      toggleLike,
      isLiked,
      playerVisible,
      hidePlayer,
      isBuffering,
      playbackError,
      autoplayEnabled,
      toggleAutoplay,
    ],
  );

  // Artwork Preloading for Next & Prev tracks
  useEffect(() => {
    if (typeof window === "undefined") return;
    const neighbours = [
      session.queue[session.currentIndex + 1],
      session.queue[session.currentIndex - 1],
    ].filter(Boolean) as Song[];

    for (const song of neighbours) {
      if (song.cover && !song.cover.startsWith("data:")) {
        const img = new Image();
        img.decoding = "async";
        img.src = song.cover;
      }
    }
  }, [session.queue, session.currentIndex]);

  const progressValue: PlayerProgressState = useMemo(
    () => ({ progress, duration }),
    [progress, duration],
  );

  return (
    <PlayerContext.Provider value={value}>
      <PlayerProgressContext.Provider value={progressValue}>
        {children}
        {/* Single Dedicated HTMLAudioElement instance rendered in React DOM tree */}
        <audio
          ref={audioRef}
          preload={settings.gaplessPlayback ? "auto" : "metadata"}
          onTimeUpdate={(event) => {
            const currentTime = event.currentTarget.currentTime;
            const currentDuration = event.currentTarget.duration;
            setProgress(currentTime);

            const now = performance.now();
            if (now - lastTimeEventRef.current > 500) {
              lastTimeEventRef.current = now;
              playbackEvents.emit("TIME_UPDATE", { currentTime, duration: currentDuration });
            }
          }}
          onLoadedMetadata={(event) => {
            const dur = event.currentTarget.duration;
            if (Number.isFinite(dur) && dur > 0) {
              setDuration(dur);
            }
          }}
          onPlay={() => {
            setPlaying(true);
            setIsBuffering(false);
          }}
          onPause={() => {
            setPlaying(false);
          }}
          onWaiting={() => {
            setIsBuffering(true);
            playbackEvents.emit("BUFFERING", { buffering: true });
          }}
          onPlaying={() => {
            setIsBuffering(false);
            playbackEvents.emit("BUFFERING", { buffering: false });
          }}
          onCanPlay={() => {
            setIsBuffering(false);
          }}
          onError={() => {
            const failedSong = current;
            setIsBuffering(false);
            setPlaying(false);

            const message = failedSong?.title
              ? `Couldn't play "${failedSong.title}". Please check audio source or try another track.`
              : "Audio source is currently unavailable.";

            setPlaybackError(message);
            playbackEvents.emit("ERROR", {
              message,
              songId: failedSong?.id ?? null,
              recoverable: false,
            });
          }}
          onEnded={() => {
            const endedSong = current;
            const audioEl = audioRef.current;
            if (!audioEl || !endedSong || audioEl.currentTime <= 0) {
              return;
            }

            const shouldLogActivity = settings.showListeningActivity && !settings.privateSession;
            if (shouldLogActivity) {
              void recordPlay(endedSong.id, duration || endedSong.duration, true);
              recordSongPlayedTimestamp(endedSong.id);
            }

            if (repeat === "one") {
              audioEl.currentTime = 0;
              void executePlay();
            } else {
              step(1, true);
            }
          }}
        />
      </PlayerProgressContext.Provider>
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer must be used inside PlayerProvider");
  return context;
}

/** Subscribes only to currentTime/duration — updates ~4x/sec during playback. */
export function usePlayerProgress() {
  return useContext(PlayerProgressContext);
}
