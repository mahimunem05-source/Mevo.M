import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import type { Song } from "@/services/songService";

import {
  deleteCustomAlbum,
  getCustomAlbums,
  setCustomAlbumPublished,
  type CustomAlbum,
} from "@/services/customAlbumService";

import { CustomAlbumDialog } from "./CustomAlbumDialog";

/** Internal section value that powers the public "Mahi Edition" filter. */
const MAHI_SECTION = "mahis-favourite";

interface MahiEditionManagerProps {
  songs: Song[];
  loading: boolean;
  error: string;
}

interface AutoAlbum {
  name: string;
  artist: string;
  cover: string | null;
  trackCount: number;
}

/**
 * Admin Dashboard → Albums → Mahi Edition.
 *
 * Auto Albums keep the existing automatic behaviour (derived from the Mahi
 * Select section). Custom Albums are hand-curated and can pull songs from
 * every section without changing their original assignment.
 */
export function MahiEditionManager({ songs, loading, error }: MahiEditionManagerProps) {
  const [customAlbums, setCustomAlbums] = useState<CustomAlbum[]>([]);
  const [customLoading, setCustomLoading] = useState(true);
  const [customError, setCustomError] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAlbum, setEditingAlbum] = useState<CustomAlbum | null>(null);
  const [deletingAlbum, setDeletingAlbum] = useState<CustomAlbum | null>(null);
  const [working, setWorking] = useState(false);

  const loadCustomAlbums = useCallback(async () => {
    setCustomLoading(true);
    setCustomError("");

    try {
      setCustomAlbums(await getCustomAlbums());
    } catch (error_) {
      setCustomError(error_ instanceof Error ? error_.message : "Could not load custom albums.");
    } finally {
      setCustomLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCustomAlbums();
  }, [loadCustomAlbums]);

  const autoAlbums = useMemo<AutoAlbum[]>(() => {
    const grouped = new Map<string, AutoAlbum>();

    for (const song of songs) {
      if (song.section !== MAHI_SECTION) continue;

      const name = (song.album ?? "").replace(/\s+/g, " ").trim();

      if (!name) continue;

      const key = name.toLowerCase();
      const existing = grouped.get(key);

      if (existing) {
        existing.trackCount += 1;
        existing.cover = existing.cover ?? song.cover_image;
        continue;
      }

      grouped.set(key, {
        name,
        artist: song.artist,
        cover: song.cover_image,
        trackCount: 1,
      });
    }

    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [songs]);

  async function runAction(action: () => Promise<void>) {
    setWorking(true);
    setCustomError("");

    try {
      await action();
      await loadCustomAlbums();
    } catch (error_) {
      setCustomError(error_ instanceof Error ? error_.message : "Action failed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mahi Edition</CardTitle>

        <CardDescription>
          Automatic albums from the Mahi Select section, plus hand-curated custom albums.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="auto">
          <TabsList>
            <TabsTrigger value="auto">Auto Albums</TabsTrigger>
            <TabsTrigger value="custom">Custom Albums</TabsTrigger>
          </TabsList>

          <TabsContent value="auto" className="mt-5 space-y-3">
            {loading && <p className="text-sm text-muted-foreground">Loading albums...</p>}

            {error && <p className="text-sm text-red-500">{error}</p>}

            {!loading && autoAlbums.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No automatic albums yet. They appear as soon as Mahi Select songs have album
                metadata.
              </p>
            )}

            {autoAlbums.map((album) => (
              <div key={album.name} className="flex items-center gap-3 rounded-xl border p-3">
                {album.cover ? (
                  <img
                    src={album.cover}
                    alt={`${album.name} cover`}
                    className="size-12 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="size-12 shrink-0 rounded-md border border-dashed" />
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{album.name}</p>

                  <p className="truncate text-xs text-muted-foreground">
                    {album.artist} · {album.trackCount} tracks
                  </p>
                </div>

                <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                  Auto
                </span>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="custom" className="mt-5 space-y-3">
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => {
                  setEditingAlbum(null);
                  setDialogOpen(true);
                }}
              >
                Create Custom Album
              </Button>
            </div>

            {customLoading && (
              <p className="text-sm text-muted-foreground">Loading custom albums...</p>
            )}

            {customError && <p className="text-sm text-red-500">{customError}</p>}

            {!customLoading && customAlbums.length === 0 && (
              <p className="text-sm text-muted-foreground">No custom albums yet.</p>
            )}

            {customAlbums.map((album) => (
              <div
                key={album.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border p-3"
              >
                {album.cover_image ? (
                  <img
                    src={album.cover_image}
                    alt={`${album.title} cover`}
                    className="size-12 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="size-12 shrink-0 rounded-md border border-dashed" />
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{album.title}</p>

                  <p className="truncate text-xs text-muted-foreground">
                    {album.songIds.length} tracks · {album.published ? "Published" : "Unpublished"}
                    {album.release_date ? ` · ${album.release_date}` : ""}
                  </p>
                </div>

                <span className="rounded-full border px-3 py-1 text-xs font-semibold text-muted-foreground">
                  Custom
                </span>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={working}
                  onClick={() =>
                    void runAction(() => setCustomAlbumPublished(album.id, !album.published))
                  }
                >
                  {album.published ? "Unpublish" : "Publish"}
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={working}
                  onClick={() => {
                    setEditingAlbum(album);
                    setDialogOpen(true);
                  }}
                >
                  Edit
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={working}
                  onClick={() => setDeletingAlbum(album)}
                >
                  Delete
                </Button>
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </CardContent>

      <CustomAlbumDialog
        open={dialogOpen}
        album={editingAlbum}
        songs={songs}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingAlbum(null);
        }}
        onSaved={() => void loadCustomAlbums()}
      />

      <AlertDialog
        open={Boolean(deletingAlbum)}
        onOpenChange={(open) => {
          if (!open) setDeletingAlbum(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this custom album?</AlertDialogTitle>

            <AlertDialogDescription>
              {deletingAlbum?.title} will be removed from the Albums page. The songs inside it are
              never deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>

            <AlertDialogAction
              disabled={working}
              onClick={() => {
                const target = deletingAlbum;
                setDeletingAlbum(null);

                if (target) {
                  void runAction(() => deleteCustomAlbum(target.id));
                }
              }}
            >
              Delete album
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
