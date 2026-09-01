import { useMemo, useState, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { motion } from "motion/react";
import { LoaderCircle, Disc3, Clock3, ListMusic, Play } from "lucide-react";

import { belongsToSection, formatTime, type SectionId } from "@/data/songs";
import { getSongs, type Song as DatabaseSong } from "@/services/songService";

import { databaseSongToPlayerSong } from "@/lib/song-adapter";
import { subscribeToRealtimeChanges } from "@/lib/realtime-helper";
import { groupSongsByAlbum, type AlbumGroup } from "@/lib/collection-utils";
import { getPublishedCustomAlbums, type CustomAlbum } from "@/services/customAlbumService";
import { PageHeader } from "@/components/music/page-header";
import { usePlayer } from "@/lib/player-context";
import { SongCoverImage } from "@/components/music/song-cover-image";

export const Route = createFileRoute("/albums")({
  head: () => ({
    meta: [
      {
        title: "Albums — MEVO",
      },
      {
        name: "description",
        content: "Browse every album in the MEVO library.",
      },
    ],
  }),
  component: AlbumsPage,
});

interface AlbumFilter {
  label: string;
  sectionId: SectionId | null;
}

const ALBUM_FILTERS: AlbumFilter[] = [
  { label: "All Albums", sectionId: null },
  { label: "Bengal Echo", sectionId: "bangla" },
  { label: "Hindi Reverie", sectionId: "hindi" },
  { label: "English Essence", sectionId: "english" },
  { label: "Mahi Edition", sectionId: "favourite" },
  { label: "Boost Aura", sectionId: "boost-aura" },
  { label: "Worldwave", sectionId: "global" },
];

function AlbumsPage() {
  const player = usePlayer();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState("All Albums");

  const songsQuery = useQuery({
    queryKey: ["homepage-songs"],
    queryFn: getSongs,
    staleTime: 1000 * 60 * 15,
    gcTime: 1000 * 60 * 60,
    placeholderData: keepPreviousData,
  });

  const customAlbumsQuery = useQuery({
    queryKey: ["custom-albums-list"],
    queryFn: () => getPublishedCustomAlbums(),
    staleTime: 1000 * 60 * 15,
    gcTime: 1000 * 60 * 60,
    placeholderData: keepPreviousData,
  });

  const databaseSongs = songsQuery.data ?? [];
  const customAlbums = customAlbumsQuery.data ?? [];
  const isLoading = songsQuery.isLoading && databaseSongs.length === 0;
  const loadError = songsQuery.error instanceof Error ? songsQuery.error.message : "";

  useEffect(() => {
    return subscribeToRealtimeChanges("albums-live", [
      {
        table: "songs",
        callback: () => {
          void queryClient.invalidateQueries({ queryKey: ["homepage-songs"], refetchType: "none" });
        },
      },
      {
        table: "custom_albums",
        callback: () => {
          void queryClient.invalidateQueries({
            queryKey: ["custom-albums-list"],
            refetchType: "none",
          });
        },
      },
      {
        table: "album_songs",
        callback: () => {
          void queryClient.invalidateQueries({
            queryKey: ["custom-albums-list"],
            refetchType: "none",
          });
        },
      },
    ]);
  }, [queryClient]);

  const autoAlbums = useMemo(() => {
    const songs = databaseSongs
      .filter((song) => (song.album ?? "").trim().length > 0)
      .map((song) => databaseSongToPlayerSong(song));

    return groupSongsByAlbum(songs);
  }, [databaseSongs]);

  const customAlbumGroups = useMemo<AlbumGroup[]>(() => {
    const songById = new Map(databaseSongs.map((song) => [song.id, song]));

    return customAlbums.map((album: CustomAlbum) => {
      const tracks = album.songIds
        .map((id) => songById.get(id))
        .filter((song): song is DatabaseSong => Boolean(song))
        .map((song) => databaseSongToPlayerSong(song));

      const year = album.release_date ? new Date(album.release_date).getFullYear() : null;

      return {
        key: `custom:${album.id}`,
        slug: album.slug,
        name: album.title,
        artist: tracks[0]?.artist ?? "Various Artists",
        year: Number.isFinite(year) ? year : null,
        cover: album.cover_image || tracks[0]?.cover || "",
        tracks,
      } satisfies AlbumGroup;
    });
  }, [customAlbums, databaseSongs]);

  const allAlbums = useMemo(
    () => [...customAlbumGroups, ...autoAlbums],
    [customAlbumGroups, autoAlbums],
  );

  const filteredAlbums = useMemo(() => {
    if (activeFilter === "All Albums") {
      return allAlbums;
    }

    const activeSectionId =
      ALBUM_FILTERS.find((filter) => filter.label === activeFilter)?.sectionId ?? null;

    if (!activeSectionId) {
      return allAlbums;
    }

    const customSlugs = new Set(customAlbumGroups.map((album) => album.slug));

    return allAlbums.filter((album) => {
      if (customSlugs.has(album.slug)) {
        return activeFilter === "Mahi Edition";
      }

      return album.tracks.some((track) => belongsToSection(track, activeSectionId));
    });
  }, [allAlbums, customAlbumGroups, activeFilter]);

  const totalTracks = allAlbums.reduce((sum, album) => sum + album.tracks.length, 0);

  const totalDuration = allAlbums.reduce(
    (sum, album) => sum + album.tracks.reduce((a, t) => a + t.duration, 0),
    0,
  );

  const filters = ALBUM_FILTERS.map((filter) => filter.label);

  const handlePlayAlbum = (e: React.MouseEvent, album: AlbumGroup) => {
    e.preventDefault();
    e.stopPropagation();
    if (album.tracks.length > 0) {
      player.playFromCollection(album.tracks, 0, {
        type: "album",
        id: album.slug,
        title: album.name,
      });
    }
  };

  return (
    <div className="pb-24">
      {/* Page Title Block */}
      <PageHeader
        eyebrow="Library"
        title="Albums"
        subtitle="Full-length records, remastered and ready to stream in one tap."
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 md:px-12">
        {/* Filters bar (Horizontal Scroll on Mobile) */}
        <div className="carousel-track no-scrollbar flex items-center gap-2 sm:gap-3 overflow-x-auto py-1 flex-nowrap sm:flex-wrap">
          {filters.map((item) => (
            <motion.button
              key={item}
              whileTap={{ scale: 0.96 }}
              onClick={() => setActiveFilter(item)}
              className={`
                whitespace-nowrap
                shrink-0
                rounded-full
                border
                px-4
                py-1.5
                text-xs
                font-medium
                sm:px-5
                sm:py-2
                sm:text-sm
                transition-all
                duration-200
                ${
                  activeFilter === item
                    ? "border-primary bg-primary/15 text-primary shadow-sm font-semibold"
                    : "border-white/[0.08] bg-card/70 text-muted-foreground hover:border-white/20 hover:text-foreground"
                }
              `}
            >
              {item}
            </motion.button>
          ))}
        </div>

        {/* Sleek Single-Bar Stats */}
        <div className="bg-white/[0.04] backdrop-blur-md border border-white/[0.08] rounded-2xl p-3 flex items-center justify-around my-3">
          {/* Item 1: Albums */}
          <div className="flex items-center gap-1.5 sm:gap-2.5">
            <Disc3 className="size-4 sm:size-5 text-teal-400 shrink-0" />
            <div className="flex items-baseline gap-1">
              <span className="text-xs sm:text-sm font-bold text-white">{allAlbums.length}</span>
              <span className="text-[10px] sm:text-xs text-muted-foreground">Albums</span>
            </div>
          </div>

          {/* Divider */}
          <div className="h-6 w-[1px] bg-white/10" />

          {/* Item 2: Duration */}
          <div className="flex items-center gap-1.5 sm:gap-2.5">
            <Clock3 className="size-4 sm:size-5 text-teal-400 shrink-0" />
            <div className="flex items-baseline gap-1">
              <span className="text-xs sm:text-sm font-bold text-white">
                {formatTime(totalDuration)}
              </span>
              <span className="text-[10px] sm:text-xs text-muted-foreground">Duration</span>
            </div>
          </div>

          {/* Divider */}
          <div className="h-6 w-[1px] bg-white/10" />

          {/* Item 3: Tracks */}
          <div className="flex items-center gap-1.5 sm:gap-2.5">
            <ListMusic className="size-4 sm:size-5 text-teal-400 shrink-0" />
            <div className="flex items-baseline gap-1">
              <span className="text-xs sm:text-sm font-bold text-white">{totalTracks}</span>
              <span className="text-[10px] sm:text-xs text-muted-foreground">Tracks</span>
            </div>
          </div>
        </div>

        {/* Loading Indicator */}
        {isLoading && (
          <div className="mt-12 flex items-center justify-center gap-3 text-sm text-muted-foreground">
            <LoaderCircle className="size-5 animate-spin text-primary" />
            Loading albums catalogue...
          </div>
        )}

        {/* Error Indicator */}
        {loadError && (
          <div className="mt-8 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-center text-xs font-semibold text-destructive">
            {loadError}
          </div>
        )}

        {/* Album Cards Grid */}
        {!isLoading && (
          <div className="mt-6 grid grid-cols-2 gap-3.5 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filteredAlbums.map((album, index) => (
              <motion.article
                key={album.key || album.slug}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.35, delay: Math.min(index * 0.03, 0.2), ease: "easeOut" }}
                whileTap={{ scale: 0.98 }}
                className="group relative rounded-2xl border border-white/[0.06] bg-card/90 p-2.5 sm:p-3 shadow-md transition-colors hover:border-white/[0.14]"
              >
                <Link
                  to="/album/$albumSlug"
                  params={{ albumSlug: album.slug }}
                  className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {/* Artwork Container */}
                  <div className="relative overflow-hidden rounded-xl">
                    <SongCoverImage
                      src={album.cover}
                      alt={`${album.name} cover`}
                      width={800}
                      height={800}
                      loading="eager"
                      decoding="auto"
                      className="aspect-square w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />

                    {/* Quick Play Button */}
                    <button
                      type="button"
                      onClick={(e) => handlePlayAlbum(e, album)}
                      aria-label={`Play ${album.name}`}
                      className="absolute bottom-2.5 right-2.5 grid size-10 place-items-center rounded-full bg-primary text-black opacity-0 translate-y-2 shadow-lg transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0 hover:scale-105 active:scale-95"
                    >
                      <Play className="size-4 translate-x-0.5 fill-current" />
                    </button>
                  </div>

                  {/* Album Name */}
                  <h2 className="mt-2.5 truncate text-sm font-semibold text-foreground">
                    {album.name}
                  </h2>

                  {/* Album Info / Artist & Track Count */}
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {album.artist} • {album.tracks.length} track
                    {album.tracks.length === 1 ? "" : "s"}
                  </p>
                </Link>
              </motion.article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
