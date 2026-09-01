import { supabase } from "@/lib/supabase";
import { slugify } from "@/lib/collection-utils";

/**
 * Manual ("custom") albums for the MEVO admin.
 *
 * Custom albums never duplicate a song and never change a song's own
 * section: they only reference existing song rows through `album_songs`.
 */

const ALBUMS_TABLE = "custom_albums";
const ALBUM_SONGS_TABLE = "album_songs";
const COVER_BUCKET = "cover-images";

export const MAHI_EDITION_COLLECTION = "mahi-edition";

export interface CustomAlbum {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  cover_image: string | null;
  cover_path: string | null;
  release_date: string | null;
  published: boolean;
  collection: string;
  display_order: number | null;
  created_at: string;
  updated_at: string;
  songIds: string[];
}

export interface CustomAlbumInput {
  title: string;
  description: string;
  releaseDate: string;
  published: boolean;
  songIds: string[];
  coverFile?: File | null;
  collection?: string;
}

interface AlbumRow {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  cover_image: string | null;
  cover_path: string | null;
  release_date: string | null;
  published: boolean;
  collection: string;
  display_order: number | null;
  created_at: string;
  updated_at: string;
  album_songs?: { song_id: string; position: number }[] | null;
}

const ALBUM_SELECT = `
  id, title, slug, description, cover_image, cover_path, release_date,
  published, collection, display_order, created_at, updated_at,
  album_songs ( song_id, position )
`;

function mapAlbum(row: AlbumRow): CustomAlbum {
  const tracks = [...(row.album_songs ?? [])].sort((a, b) => a.position - b.position);

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    cover_image: row.cover_image,
    cover_path: row.cover_path,
    release_date: row.release_date,
    published: row.published,
    collection: row.collection,
    display_order: row.display_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
    songIds: tracks.map((track) => track.song_id),
  };
}

import { deleteFileFromB2, uploadCoverToB2 } from "@/lib/b2-storage";

function fileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() || "jpg";
}

async function uploadCover(file: File): Promise<{
  publicUrl: string;
  path: string;
}> {
  try {
    const { publicUrl, key } = await uploadCoverToB2(file);
    return { publicUrl, path: key };
  } catch (error) {
    throw new Error(
      `Could not upload the album cover: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
}

async function buildUniqueSlug(title: string, ignoreId?: string): Promise<string> {
  const base = slugify(title) || "album";

  const { data, error } = await supabase
    .from(ALBUMS_TABLE)
    .select("id, slug")
    .like("slug", `${base}%`);

  if (error) {
    throw new Error(`Could not create an album link: ${error.message}`);
  }

  const taken = new Set(
    (data ?? []).filter((row) => row.id !== ignoreId).map((row) => row.slug as string),
  );

  if (!taken.has(base)) {
    return base;
  }

  let counter = 2;

  while (taken.has(`${base}-${counter}`)) {
    counter += 1;
  }

  return `${base}-${counter}`;
}

async function replaceAlbumSongs(albumId: string, songIds: string[]): Promise<void> {
  const { error: deleteError } = await supabase
    .from(ALBUM_SONGS_TABLE)
    .delete()
    .eq("album_id", albumId);

  if (deleteError) {
    throw new Error(`Could not update album tracks: ${deleteError.message}`);
  }

  if (songIds.length === 0) {
    return;
  }

  const rows = songIds.map((songId, index) => ({
    album_id: albumId,
    song_id: songId,
    position: index,
  }));

  const { error: insertError } = await supabase.from(ALBUM_SONGS_TABLE).insert(rows);

  if (insertError) {
    throw new Error(`Could not save album tracks: ${insertError.message}`);
  }
}

/** All custom albums for a collection (admin view — includes drafts). */
export async function getCustomAlbums(
  collection: string = MAHI_EDITION_COLLECTION,
): Promise<CustomAlbum[]> {
  const { data, error } = await supabase
    .from(ALBUMS_TABLE)
    .select(ALBUM_SELECT)
    .eq("collection", collection)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Could not load custom albums: ${error.message}`);
  }

  return ((data ?? []) as unknown as AlbumRow[]).map(mapAlbum);
}

/** Published custom albums only (public site). */
export async function getPublishedCustomAlbums(
  collection: string = MAHI_EDITION_COLLECTION,
): Promise<CustomAlbum[]> {
  const { data, error } = await supabase
    .from(ALBUMS_TABLE)
    .select(ALBUM_SELECT)
    .eq("collection", collection)
    .eq("published", true)
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Could not load published custom albums:", error);
    return [];
  }

  return ((data ?? []) as unknown as AlbumRow[]).map(mapAlbum);
}

export async function getPublishedCustomAlbumBySlug(slug: string): Promise<CustomAlbum | null> {
  const { data, error } = await supabase
    .from(ALBUMS_TABLE)
    .select(ALBUM_SELECT)
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();

  if (error) {
    console.error("Could not load custom album:", error);
    return null;
  }

  return data ? mapAlbum(data as unknown as AlbumRow) : null;
}

export async function createCustomAlbum(input: CustomAlbumInput): Promise<CustomAlbum> {
  const title = input.title.trim();

  if (!title) {
    throw new Error("Please enter an album title.");
  }

  const collection = input.collection ?? MAHI_EDITION_COLLECTION;
  const slug = await buildUniqueSlug(title);

  let cover: { publicUrl: string; path: string } | null = null;

  if (input.coverFile) {
    cover = await uploadCover(input.coverFile);
  }

  const { data, error } = await supabase
    .from(ALBUMS_TABLE)
    .insert({
      title,
      slug,
      description: input.description.trim() || null,
      cover_image: cover?.publicUrl ?? null,
      cover_path: cover?.path ?? null,
      release_date: input.releaseDate.trim() || null,
      published: input.published,
      collection,
    })
    .select(ALBUM_SELECT)
    .single();

  if (error || !data) {
    throw new Error(`Could not create the album: ${error?.message ?? "unknown error"}`);
  }

  const album = mapAlbum(data as unknown as AlbumRow);

  await replaceAlbumSongs(album.id, input.songIds);

  return { ...album, songIds: input.songIds };
}

export async function updateCustomAlbum(albumId: string, input: CustomAlbumInput): Promise<void> {
  const title = input.title.trim();

  if (!title) {
    throw new Error("Please enter an album title.");
  }

  const slug = await buildUniqueSlug(title, albumId);

  const patch: Record<string, unknown> = {
    title,
    slug,
    description: input.description.trim() || null,
    release_date: input.releaseDate.trim() || null,
    published: input.published,
  };

  if (input.coverFile) {
    const cover = await uploadCover(input.coverFile);
    patch.cover_image = cover.publicUrl;
    patch.cover_path = cover.path;
  }

  const { error } = await supabase.from(ALBUMS_TABLE).update(patch).eq("id", albumId);

  if (error) {
    throw new Error(`Could not update the album: ${error.message}`);
  }

  await replaceAlbumSongs(albumId, input.songIds);
}

export async function setCustomAlbumPublished(albumId: string, published: boolean): Promise<void> {
  const { error } = await supabase.from(ALBUMS_TABLE).update({ published }).eq("id", albumId);

  if (error) {
    throw new Error(`Could not change publish status: ${error.message}`);
  }
}

/** Deletes the album and its song links only — songs are never removed. */
export async function deleteCustomAlbum(albumId: string): Promise<void> {
  const { data } = await supabase
    .from(ALBUMS_TABLE)
    .select("cover_path, cover_image")
    .eq("id", albumId)
    .maybeSingle();

  const { error } = await supabase.from(ALBUMS_TABLE).delete().eq("id", albumId);

  if (error) {
    throw new Error(`Could not delete the album: ${error.message}`);
  }

  const row = data as { cover_path?: string | null; cover_image?: string | null } | null;
  const coverPath = row?.cover_path || row?.cover_image;

  if (coverPath) {
    await deleteFileFromB2(coverPath);
  }
}
