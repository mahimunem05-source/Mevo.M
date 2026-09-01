import {
  DEFAULT_COVER,
  normalizeDbSection,
  sections,
  type SectionId,
  type Song as PlayerSong,
} from "@/data/songs";
import type { Song as DatabaseSong, SongSection } from "@/services/songService";

export function databaseSectionToPlayerSection(section: SongSection): SectionId {
  return normalizeDbSection(section);
}

function getSongYear(song: DatabaseSong): number {
  const sourceDate = song.release_date || song.created_at;
  const parsedYear = sourceDate ? new Date(sourceDate).getFullYear() : Number.NaN;

  return Number.isFinite(parsedYear) ? parsedYear : new Date().getFullYear();
}

export function databaseSongToPlayerSong(
  song: DatabaseSong,
  options: { trending?: boolean } = {},
): PlayerSong {
  const section = databaseSectionToPlayerSection(song.section);
  const category = sections.find((item) => item.id === section)?.title ?? "Music";

  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album?.trim() || "Singles",
    genre: song.genre?.trim() || "Unknown",
    year: getSongYear(song),
    duration: Number.isFinite(song.duration) ? Math.max(0, Math.round(song.duration)) : 0,
    cover: song.cover_image?.trim() || DEFAULT_COVER,
    audio: song.audio_file,
    section,
    category,
    trending: options.trending ?? false,
    is_explicit: (song as { is_explicit?: boolean }).is_explicit ?? false,
    created_at: song.created_at,
    release_date: song.release_date,
    play_count: song.play_count ?? 0,
    plays: song.play_count ?? 0,
  };
}

/**
 * Kept for compatibility with any existing imports. It merges real player
 * songs by ID; no demo catalogue is injected here.
 */
export function mergePlayerSongs(
  primary: readonly PlayerSong[],
  secondary: readonly PlayerSong[],
): PlayerSong[] {
  const byId = new Map<string, PlayerSong>();

  for (const song of secondary) {
    byId.set(String(song.id), song);
  }

  for (const song of primary) {
    byId.set(String(song.id), song);
  }

  return Array.from(byId.values());
}
