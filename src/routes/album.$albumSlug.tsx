import { useEffect, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { getSongs, type Song as DatabaseSong } from "@/services/songService";
import { databaseSongToPlayerSong } from "@/lib/song-adapter";
import { subscribeToRealtimeChanges } from "@/lib/realtime-helper";
import { getPublishedCustomAlbumBySlug, type CustomAlbum } from "@/services/customAlbumService";
import { usePlayer } from "@/lib/player-context";
import { groupSongsByAlbum, shuffleArray, sumDuration } from "@/lib/collection-utils";
import { CollectionHeader } from "@/components/music/collection-header";
import { SongList } from "@/components/music/song-list";
import { AppBackButton } from "@/components/music/app-back-button";

export const Route = createFileRoute("/album/$albumSlug")({
  component: AlbumDetailsPage,
});

function AlbumDetailsPage() {
  const { albumSlug } = Route.useParams();
  const player = usePlayer();
  const queryClient = useQueryClient();

  const songsQuery = useQuery({
    queryKey: ["homepage-songs"],
    queryFn: getSongs,
    staleTime: 1000 * 60 * 15,
    gcTime: 1000 * 60 * 60,
    placeholderData: keepPreviousData,
  });

  const customAlbumQuery = useQuery({
    queryKey: ["custom-album", albumSlug],
    queryFn: () => getPublishedCustomAlbumBySlug(albumSlug),
    staleTime: 1000 * 60 * 15,
    gcTime: 1000 * 60 * 60,
    placeholderData: keepPreviousData,
  });

  const databaseSongs = songsQuery.data ?? [];
  const customAlbum = customAlbumQuery.data ?? null;
  const isLoading = songsQuery.isLoading && databaseSongs.length === 0;
  const loadError = songsQuery.error instanceof Error ? songsQuery.error.message : "";

  useEffect(() => {
    return subscribeToRealtimeChanges(`album-details-published-songs-${albumSlug}`, [
      {
        table: "songs",
        callback: () => {
          void queryClient.invalidateQueries({ queryKey: ["homepage-songs"] });
        },
      },
    ]);
  }, [albumSlug, queryClient]);

  const album = useMemo(() => {
    const uploadedSongs = databaseSongs.map((song) => databaseSongToPlayerSong(song));

    // Manually curated albums win when their slug matches, because they are
    // explicit admin selections rather than derived groupings.
    if (customAlbum) {
      const songById = new Map(uploadedSongs.map((song) => [song.id, song]));

      const tracks = customAlbum.songIds
        .map((id) => songById.get(id))
        .filter((song): song is (typeof uploadedSongs)[number] => Boolean(song));

      const year = customAlbum.release_date
        ? new Date(customAlbum.release_date).getFullYear()
        : null;

      return {
        key: `custom:${customAlbum.id}`,
        slug: customAlbum.slug,
        name: customAlbum.title,
        artist: tracks[0]?.artist ?? "Various Artists",
        year: Number.isFinite(year) ? year : null,
        cover: customAlbum.cover_image || tracks[0]?.cover || "",
        tracks,
      };
    }

    return groupSongsByAlbum(uploadedSongs).find((group) => group.slug === albumSlug);
  }, [databaseSongs, albumSlug, customAlbum]);

  const songs = album?.tracks ?? [];

  const totalDuration = sumDuration(songs);
  const hasSongs = songs.length > 0;

  const queueSource = useMemo(
    () => ({
      type: "album" as const,
      id: albumSlug,
      title: album?.name ?? "Album",
    }),
    [albumSlug, album?.name],
  );

  const navigationSource = useMemo(
    () => ({
      ...queueSource,
      pathname: `/album/${albumSlug}`,
      label: album?.name ?? "Album",
    }),
    [queueSource, albumSlug, album?.name],
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-6 pb-16 md:px-12">
        <AppBackButton fallbackTo="/albums" />
        <div className="flex items-center gap-2 rounded-3xl glass p-6 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading album...
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-6xl px-6 pb-16 md:px-12">
        <AppBackButton fallbackTo="/albums" />
        <p className="text-sm text-red-500" role="alert">
          {loadError}
        </p>
      </div>
    );
  }

  if (!album) {
    return (
      <div className="mx-auto max-w-6xl px-6 pb-16 md:px-12">
        <AppBackButton fallbackTo="/albums" />
        <div className="rounded-3xl glass p-10 text-center">
          <p className="font-semibold">Album not found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been removed, or the link is incorrect.
          </p>
        </div>
      </div>
    );
  }

  const isCurrentPlaying =
    player.queueSource?.type === queueSource.type &&
    player.queueSource?.id === queueSource.id &&
    player.current !== null;

  const isShuffled = isCurrentPlaying && player.shuffle;

  return (
    <div className="pb-32 pt-2">
      <AppBackButton fallbackTo="/albums" />

      <CollectionHeader
        type="album"
        image={album.cover}
        title={album.name}
        subtitle={album.artist}
        year={album.year}
        songCount={songs.length}
        totalDuration={totalDuration}
        disabled={!hasSongs}
        isShuffled={isShuffled}
        onPlayAll={() => {
          if (hasSongs) player.playFromCollection(songs, 0, queueSource, navigationSource);
        }}
        onShuffle={() => {
          if (!hasSongs) return;
          if (isCurrentPlaying) {
            player.toggleShuffle();
          } else {
            const shuffled = shuffleArray(songs);
            player.playFromCollection(shuffled, 0, queueSource, navigationSource);
            if (!player.shuffle) {
              player.toggleShuffle();
            }
          }
        }}
      />

      <div className="mt-8">
        <SongList
          songs={songs}
          queueSource={queueSource}
          navigationSource={navigationSource}
          showAlbum={false}
          emptyMessage="No songs in this album yet."
        />
      </div>
    </div>
  );
}
