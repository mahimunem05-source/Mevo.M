import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { LoaderCircle, Music2, Play, Shuffle, ListMusic } from "lucide-react";
import { usePlayer } from "@/lib/player-context";
import { useTranslation } from "@/hooks/useTranslation";
import { getSongs, type Song as DatabaseSong } from "@/services/songService";
import { databaseSongToPlayerSong, mergePlayerSongs } from "@/lib/song-adapter";
import {
  songs as staticSongs,
  type Song,
  type QueueSource,
  type NavigationSource,
} from "@/data/songs";
import { subscribeToRealtimeChanges } from "@/lib/realtime-helper";
import { shuffleArray } from "@/lib/collection-utils";
import { cn } from "@/lib/utils";
import { SongList } from "@/components/music/song-list";
import { PageHeader } from "@/components/music/page-header";

export const Route = createFileRoute("/all-songs")({
  head: () => ({
    meta: [
      { title: "All Songs — MEVO" },
      {
        name: "description",
        content: "Browse and stream all available songs in the MEVO music library.",
      },
      { property: "og:title", content: "All Songs — MEVO" },
      {
        property: "og:description",
        content: "Browse and stream all available songs in the MEVO music library.",
      },
    ],
  }),
  component: AllSongsPage,
});

const QUEUE_SOURCE: QueueSource = {
  type: "section",
  id: "all-songs",
  title: "All Songs",
};

const NAV_SOURCE: NavigationSource = {
  type: "section",
  id: "all-songs",
  title: "All Songs",
  pathname: "/all-songs",
  label: "All Songs",
};

function AllSongsPage() {
  const player = usePlayer();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const songsQuery = useQuery({
    queryKey: ["all-library-songs"],
    queryFn: getSongs,
    staleTime: 1000 * 60 * 15,
    gcTime: 1000 * 60 * 60,
    placeholderData: keepPreviousData,
  });

  const databaseSongs = songsQuery.data ?? [];
  const isLoading = songsQuery.isLoading && databaseSongs.length === 0;

  // Realtime updates when songs are added/edited in database
  useEffect(() => {
    return subscribeToRealtimeChanges("all-songs-page-realtime", [
      {
        table: "songs",
        callback: () => {
          void queryClient.invalidateQueries({
            queryKey: ["all-library-songs"],
            refetchType: "none",
          });
        },
      },
    ]);
  }, [queryClient]);

  const allSongs = useMemo(() => {
    const uploadedSongs = databaseSongs.map((s) => databaseSongToPlayerSong(s));
    return mergePlayerSongs(uploadedSongs, staticSongs);
  }, [databaseSongs]);

  const isCurrentPlaying = player.queueSource?.id === QUEUE_SOURCE.id && player.current !== null;

  const isShuffleActive = isCurrentPlaying && player.shuffle;

  const handlePlayAll = () => {
    if (allSongs.length > 0) {
      player.playFromCollection(allSongs, 0, QUEUE_SOURCE, NAV_SOURCE);
    }
  };

  const handleShuffle = () => {
    if (allSongs.length === 0) return;
    if (isCurrentPlaying) {
      player.toggleShuffle();
    } else {
      const shuffled = shuffleArray(allSongs);
      player.playFromCollection(shuffled, 0, QUEUE_SOURCE, NAV_SOURCE);
      if (!player.shuffle) {
        player.toggleShuffle();
      }
    }
  };

  return (
    <div className="pb-36 pt-2">
      {/* Header with Title & Action Controls */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6 md:px-12">
        <PageHeader
          eyebrow={t("nav.library", "Library")}
          title={t("nav.allSongs", "All Songs")}
          subtitle={`${allSongs.length} tracks available in your library`}
        />

        {/* Action Controls: Play All & Shuffle */}
        <div className="flex flex-wrap items-center gap-3 pb-6 pt-1">
          <button
            type="button"
            onClick={handlePlayAll}
            disabled={allSongs.length === 0}
            className="flex items-center gap-2.5 rounded-full bg-[#4FD1C5] px-6 py-2.5 text-xs sm:text-sm font-bold text-[#071012] shadow-[0_0_20px_rgba(79,209,197,0.35)] transition-all hover:brightness-110 active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <Play className="size-4 fill-current" />
            <span>Play All</span>
          </button>

          <button
            type="button"
            onClick={handleShuffle}
            disabled={allSongs.length === 0}
            aria-label={isShuffleActive ? "Shuffle is on" : "Shuffle is off"}
            title={isShuffleActive ? "Shuffle On" : "Shuffle Off"}
            className={cn(
              "flex items-center gap-2.5 rounded-full border px-5 py-2.5 text-xs sm:text-sm font-bold backdrop-blur-md transition-all duration-200 active:scale-95 disabled:opacity-50 cursor-pointer",
              isShuffleActive
                ? "border-[#4FD1C5] bg-[#4FD1C5]/20 text-[#4FD1C5] shadow-[0_0_20px_rgba(79,209,197,0.35)] hover:bg-[#4FD1C5]/25"
                : "border-white/15 bg-white/[0.07] text-white hover:bg-white/[0.12] hover:text-white",
            )}
          >
            <Shuffle
              className={cn(
                "size-4 transition-colors",
                isShuffleActive ? "text-[#4FD1C5]" : "text-teal-400",
              )}
            />
            <span>Shuffle</span>
          </button>
        </div>

        {/* Songs List */}
        {isLoading ? (
          <div className="flex items-center justify-center gap-3 rounded-3xl glass p-12 text-sm text-white/60">
            <LoaderCircle className="size-5 animate-spin text-teal-400" />
            <span>Loading library tracks...</span>
          </div>
        ) : allSongs.length === 0 ? (
          <div className="rounded-3xl glass p-12 text-center">
            <Music2 className="mx-auto mb-3 size-10 text-white/40" />
            <p className="font-semibold text-white">No tracks found</p>
            <p className="mt-1 text-xs text-white/50">Your library is currently empty.</p>
          </div>
        ) : (
          <SongList
            songs={allSongs}
            queueSource={QUEUE_SOURCE}
            navigationSource={NAV_SOURCE}
            showAlbum={true}
            isSeeAllView={true}
          />
        )}
      </div>
    </div>
  );
}
