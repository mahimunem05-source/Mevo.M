import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { ACCEPTED_COVER_ACCEPT, prepareCoverImage } from "@/lib/cover-image";
import { SONG_SECTION_OPTIONS, type Song } from "@/services/songService";

import {
  createCustomAlbum,
  updateCustomAlbum,
  type CustomAlbum,
} from "@/services/customAlbumService";

interface CustomAlbumDialogProps {
  open: boolean;
  album: CustomAlbum | null;
  songs: Song[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

function sectionLabel(value: string): string {
  return SONG_SECTION_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

/** Create / edit form for a manual Mahi Edition album. */
export function CustomAlbumDialog({
  open,
  album,
  songs,
  onOpenChange,
  onSaved,
}: CustomAlbumDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [published, setPublished] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    setTitle(album?.title ?? "");
    setDescription(album?.description ?? "");
    setReleaseDate(album?.release_date ?? "");
    setPublished(album?.published ?? false);
    setSelectedIds(album?.songIds ?? []);
    setCoverFile(null);
    setCoverPreview(album?.cover_image ?? null);
    setQuery("");
    setSectionFilter("all");
    setError("");
  }, [open, album]);

  const songById = useMemo(() => {
    const map = new Map<string, Song>();
    for (const song of songs) map.set(song.id, song);
    return map;
  }, [songs]);

  const filteredSongs = useMemo(() => {
    const term = query.trim().toLowerCase();

    return songs.filter((song) => {
      if (sectionFilter !== "all" && song.section !== sectionFilter) {
        return false;
      }

      if (!term) {
        return true;
      }

      return (
        (song.title ?? "").toLowerCase().includes(term) ||
        (song.artist ?? "").toLowerCase().includes(term) ||
        (song.album ?? "").toLowerCase().includes(term)
      );
    });
  }, [songs, query, sectionFilter]);

  const selectedSongs = selectedIds
    .map((id) => songById.get(id))
    .filter((song): song is Song => Boolean(song));

  function toggleSong(songId: string) {
    setSelectedIds((current) =>
      current.includes(songId) ? current.filter((id) => id !== songId) : [...current, songId],
    );
  }

  function moveSong(from: number, to: number) {
    setSelectedIds((current) => {
      if (to < 0 || to >= current.length || from === to) {
        return current;
      }

      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function handleCoverChange(file: File | undefined) {
    if (!file) return;

    try {
      const prepared = await prepareCoverImage(file);
      setCoverFile(prepared.file);
      setCoverPreview(prepared.previewUrl);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Could not read that cover image.");
    }
  }

  async function handleSave() {
    setSaving(true);
    setError("");

    try {
      const payload = {
        title,
        description,
        releaseDate,
        published,
        songIds: selectedIds,
        coverFile,
      };

      if (album) {
        await updateCustomAlbum(album.id, payload);
      } else {
        await createCustomAlbum(payload);
      }

      onSaved();
      onOpenChange(false);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Could not save the album.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{album ? "Edit custom album" : "Create custom album"}</DialogTitle>

          <DialogDescription>
            Songs stay in their original sections — this album only references them.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 sm:grid-cols-[160px_1fr]">
          <div className="space-y-2">
            <Label>Album cover</Label>

            {coverPreview ? (
              <img
                src={coverPreview}
                alt="Album cover preview"
                className="aspect-square w-full rounded-xl object-cover"
              />
            ) : (
              <div className="grid aspect-square w-full place-items-center rounded-xl border border-dashed text-xs text-muted-foreground">
                No cover
              </div>
            )}

            <Input
              type="file"
              accept={ACCEPTED_COVER_ACCEPT}
              disabled={saving}
              onChange={(event) => void handleCoverChange(event.target.files?.[0])}
            />
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="album-title">Album title</Label>

              <Input
                id="album-title"
                value={title}
                disabled={saving}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Mahi Edition Vol. 1"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="album-description">Description</Label>

              <Textarea
                id="album-description"
                value={description}
                disabled={saving}
                rows={3}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="album-release">Release date</Label>

                <Input
                  id="album-release"
                  type="date"
                  value={releaseDate}
                  disabled={saving}
                  onChange={(event) => setReleaseDate(event.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="album-status">Publish status</Label>

                <select
                  id="album-status"
                  value={published ? "published" : "draft"}
                  disabled={saving}
                  onChange={(event) => setPublished(event.target.value === "published")}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="draft">Unpublished</option>
                  <option value="published">Published</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-2 grid gap-5 md:grid-cols-2">
          <div className="space-y-3">
            <Label>Add songs</Label>

            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input
                value={query}
                placeholder="Search songs"
                onChange={(event) => setQuery(event.target.value)}
              />

              <select
                value={sectionFilter}
                onChange={(event) => setSectionFilter(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All sections</option>

                {SONG_SECTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border p-2">
              {filteredSongs.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">No songs found.</p>
              )}

              {filteredSongs.map((song) => {
                const checked = selectedIds.includes(song.id);

                return (
                  <label
                    key={song.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-muted"
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleSong(song.id)} />

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{song.title}</span>

                      <span className="block truncate text-xs text-muted-foreground">
                        {song.artist} · {sectionLabel(song.section)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <Label>Selected songs ({selectedSongs.length})</Label>

            <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border p-2">
              {selectedSongs.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">No songs selected yet.</p>
              )}

              {selectedSongs.map((song, index) => (
                <div
                  key={song.id}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragIndex !== null) moveSong(dragIndex, index);
                    setDragIndex(null);
                  }}
                  className="flex items-center gap-2 rounded-lg border bg-background p-2"
                >
                  <span className="w-6 shrink-0 cursor-grab text-center text-xs text-muted-foreground">
                    {index + 1}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{song.title}</span>

                    <span className="block truncate text-xs text-muted-foreground">
                      {song.artist}
                    </span>
                  </span>

                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => moveSong(index, index - 1)}
                  >
                    ↑
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => moveSong(index, index + 1)}
                  >
                    ↓
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => toggleSong(song.id)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Drag a row, or use the arrows, to change track order. Removing a song here never
              deletes the original song.
            </p>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-500" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>

          <Button type="button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? "Saving..." : album ? "Save album" : "Create album"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
