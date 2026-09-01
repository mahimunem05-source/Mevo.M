import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Heart, LoaderCircle, Music2 } from "lucide-react";
import { usePlayer } from "@/lib/player-context";
import { getSongs, type Song as DatabaseSong } from "@/services/songService";
import { databaseSongToPlayerSong } from "@/lib/song-adapter";
import { SongCard } from "@/components/music/song-card";
import { PageHeader } from "@/components/music/page-header";

export const Route = createFileRoute("/favorites")({
  head: () => ({
    meta: [
      { title: "Favorites — MEVO" },
      { name: "description", content: "Your liked songs on MEVO." },
    ],
  }),
  component: FavoritesPage,
});

function FavoritesPage() {
  const player = usePlayer();
  const [allDatabaseSongs, setAllDatabaseSongs] = useState<DatabaseSong[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const fetched = await getSongs();
        setAllDatabaseSongs(fetched);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }
    void load();
  }, []);

  const likedSongs = useMemo(() => {
    const playerSongs = allDatabaseSongs.map((s) => databaseSongToPlayerSong(s));
    return playerSongs.filter((s) => player.isLiked(s.id));
  }, [allDatabaseSongs, player.likes]);

  return (
    <div className="pb-24">
      <PageHeader
        eyebrow="Collection"
        title="Your Favorites"
        subtitle="The tracks you've saved and loved."
      />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 md:px-12">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin text-primary" /> Loading favorites...
          </div>
        ) : likedSongs.length === 0 ? (
          <div className="rounded-3xl glass p-10 text-center">
            <Heart className="mx-auto mb-3 size-8 text-teal-400" />
            <p className="font-semibold text-white">No favorites yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Tap the heart icon on any track to save it here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {likedSongs.map((song, index) => (
              <SongCard
                key={song.id}
                song={song}
                collectionSongs={likedSongs}
                collectionIndex={index}
                queueSource={{ type: "favourite", id: "favorites", title: "Favorites" }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
