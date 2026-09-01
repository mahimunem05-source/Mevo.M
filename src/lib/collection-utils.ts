import type { Song } from "@/data/songs";

/** URL-safe slug. Keeps Unicode letters/numbers (Bengali, etc.) intact. */
export function slugify(value: string): string {
  const normalized = (value ?? "").normalize("NFKC").trim().toLowerCase();

  if (!normalized) {
    return "unknown";
  }

  const slug = normalized
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "unknown";
}

export function shuffleArray<T>(items: readonly T[]): T[] {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }

  return shuffled;
}

export function sumDuration(songs: readonly Song[]): number {
  return songs.reduce((total, song) => total + song.duration, 0);
}

function cleanGroupName(value: string | null | undefined, fallback: string): string {
  const cleaned = (value ?? "")
    .replace(/^[\s,_]+|[\s,_]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || fallback;
}

/** Disambiguates slug collisions (two different names slugifying to the same string). */
function withUniqueSlugs<T extends { slug: string }>(groups: T[]): T[] {
  const seen = new Map<string, number>();

  return groups.map((group) => {
    const count = seen.get(group.slug) ?? 0;
    seen.set(group.slug, count + 1);

    if (count === 0) {
      return group;
    }

    return { ...group, slug: `${group.slug}-${count + 1}` };
  });
}

export interface AlbumGroup {
  key: string;
  slug: string;
  name: string;
  artist: string;
  year: number | null;
  cover: string;
  tracks: Song[];
}

/** Groups songs by album name. Used by both /albums and /album/$albumSlug so their keys always match. */
export function groupSongsByAlbum(songs: readonly Song[]): AlbumGroup[] {
  const groups = new Map<string, AlbumGroup>();

  for (const song of songs) {
    const name = cleanGroupName(song.album, "Singles");
    const key = name.toLocaleLowerCase();
    const existing = groups.get(key);

    if (existing) {
      existing.tracks.push(song);
      if (!existing.cover && song.cover) existing.cover = song.cover;
      if (existing.year === null && Number.isFinite(song.year)) {
        existing.year = song.year;
      }
      continue;
    }

    groups.set(key, {
      key,
      slug: slugify(name),
      name,
      artist: song.artist,
      year: Number.isFinite(song.year) ? song.year : null,
      cover: song.cover,
      tracks: [song],
    });
  }

  const sorted = Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));

  return withUniqueSlugs(sorted);
}

export interface ArtistGroup {
  key: string;
  slug: string;
  name: string;
  cover: string | null;
  is_verified?: boolean;
  tracks: Song[];
}

export interface CustomArtistMetadata {
  name: string;
  image_url?: string | null;
  is_verified?: boolean;
}

/** Groups songs by artist name. Used by both /artists and /artist/$artistSlug so their keys always match. */
export function groupSongsByArtist(
  songs: readonly Song[],
  customArtists: readonly CustomArtistMetadata[] = [],
): ArtistGroup[] {
  const groups = new Map<string, ArtistGroup>();

  const customMap = new Map<string, CustomArtistMetadata>();
  for (const item of customArtists) {
    if (item.name) {
      customMap.set(item.name.trim().toLowerCase(), item);
    }
  }

  for (const song of songs) {
    const name = cleanGroupName(song.artist, "Unknown Artist");
    const key = name.toLocaleLowerCase();
    const existing = groups.get(key);
    const custom = customMap.get(key);

    if (existing) {
      existing.tracks.push(song);
      if (custom?.image_url) {
        existing.cover = custom.image_url;
      } else if (!existing.cover && song.cover) {
        existing.cover = song.cover;
      }
      if (custom?.is_verified !== undefined) {
        existing.is_verified = custom.is_verified;
      }
      continue;
    }

    const resolvedCover = custom?.image_url || song.cover || null;
    const isVerified = Boolean(custom?.is_verified);

    groups.set(key, {
      key,
      slug: slugify(name),
      name,
      cover: resolvedCover,
      is_verified: isVerified,
      tracks: [song],
    });
  }

  // Ensure all groups have any custom metadata applied
  for (const [key, group] of groups.entries()) {
    const custom = customMap.get(key);
    if (custom) {
      if (custom.image_url) {
        group.cover = custom.image_url;
      }
      if (custom.is_verified !== undefined) {
        group.is_verified = Boolean(custom.is_verified);
      }
    }
  }

  const sorted = Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));

  return withUniqueSlugs(sorted);
}

/**
 * Smart recommendation engine for Featured section rows.
 * - Dynamic ranking based on trending status, popularity, recency.
 * - Artist diversity cap (max 2 songs per artist).
 * - Deterministic daily seed (sectionId + YYYY-MM-DD) for stable daily rotation.
 * - Robust fallback chain when fewer than limit songs exist.
 */
export function getFeaturedSongsForSection(
  sectionId: string,
  sectionSongs: readonly Song[],
  allCatalogue: readonly Song[] = [],
  trendingSongIds: Set<string> = new Set(),
  limit = 5,
): Song[] {
  if (sectionSongs.length === 0 && allCatalogue.length === 0) {
    return [];
  }

  // Daily seed for stable daily rotation
  const dateSeed = new Date().toISOString().slice(0, 10);
  const seedBase = `${sectionId}:${dateSeed}`;

  function getDeterministicScore(song: Song): number {
    let score = 0;
    // 1. Trending membership (highest weight)
    if (trendingSongIds.has(song.id)) {
      score += 1000;
    }
    // 2. Play count / Duration proxy
    if (song.duration > 0) {
      score += Math.min(song.duration, 300) / 10;
    }
    // 3. Recency
    if (song.year && song.year >= 2024) {
      score += 20;
    }
    // 4. Deterministic daily seed offset (0 - 99)
    let hash = 5381;
    const key = `${seedBase}:${song.id}`;
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 33) ^ key.charCodeAt(i);
    }
    score += Math.abs(hash) % 100;

    return score;
  }

  // Candidate pool: sectionSongs first, then allCatalogue for fallback
  const pool = sectionSongs.length > 0 ? [...sectionSongs] : [...allCatalogue];

  // Sort pool by deterministic score descending
  const sortedPool = [...pool].sort((a, b) => getDeterministicScore(b) - getDeterministicScore(a));

  const selected: Song[] = [];
  const selectedIds = new Set<string>();
  const artistCounts = new Map<string, number>();

  // Rule: Max 2 songs per artist unless section has only 1 artist
  const totalDistinctArtists = new Set(pool.map((s) => s.artist.toLowerCase())).size;
  const maxPerArtist = totalDistinctArtists > 1 ? 2 : 999;

  for (const song of sortedPool) {
    if (selected.length >= limit) break;
    if (selectedIds.has(song.id)) continue;

    const artistKey = song.artist.toLowerCase();
    const count = artistCounts.get(artistKey) ?? 0;

    if (count < maxPerArtist) {
      selected.push(song);
      selectedIds.add(song.id);
      artistCounts.set(artistKey, count + 1);
    }
  }

  // Fallback 1: If still < limit, relax artist limit on sectionSongs
  if (selected.length < limit) {
    for (const song of sortedPool) {
      if (selected.length >= limit) break;
      if (!selectedIds.has(song.id)) {
        selected.push(song);
        selectedIds.add(song.id);
      }
    }
  }

  // Fallback 2: Pull from allCatalogue if still < limit
  if (selected.length < limit && allCatalogue.length > 0) {
    const sortedCatalogue = [...allCatalogue].sort(
      (a, b) => getDeterministicScore(b) - getDeterministicScore(a),
    );

    for (const song of sortedCatalogue) {
      if (selected.length >= limit) break;
      if (!selectedIds.has(song.id)) {
        selected.push(song);
        selectedIds.add(song.id);
      }
    }
  }

  return selected;
}
