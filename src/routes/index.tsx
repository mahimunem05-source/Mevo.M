import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { motion } from "motion/react";
import { LoaderCircle } from "lucide-react";

import {
  belongsToSection,
  recentlyPlayedSection,
  replaceRuntimeSongs,
  sections,
  trendingSection,
  type SectionId,
  type Song as PlayerSong,
} from "@/data/songs";
import { getSongs, getTrendingSongs } from "@/services/songService";
import { databaseSongToPlayerSong } from "@/lib/song-adapter";
import { supabase } from "@/lib/supabase";
import { subscribeToRealtimeChanges } from "@/lib/realtime-helper";
import { usePlayer } from "@/lib/player-context";
import { playbackEvents } from "@/lib/playback-events";
import { rankHomeSections, rankSectionTracks } from "@/lib/feedRanking";

import { HeroBanner } from "@/components/music/hero-banner";
import { SectionRow } from "@/components/music/section-row";
import { HomepageSkeleton, HeroBannerSkeleton } from "@/components/music/skeletons";
import {
  getHeroSettings,
  getHeroSongsRecords,
  getCurrentHeroPeriod,
  generateAutomaticHeroSongs,
} from "@/services/heroService";
import { DEFAULT_HERO_SETTINGS } from "@/types/hero";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: "MEVO — Evolution of Sound",
      },
      {
        name: "description",
        content:
          "Discover millions of songs, playlists and artists. Stream instantly with immersive sound on MEVO.",
      },
      {
        property: "og:title",
        content: "MEVO — Evolution of Sound",
      },
      {
        property: "og:description",
        content: "Bangla beats, soft Hindi vibes and global tracks in one premium player.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const { recent } = usePlayer();
  const queryClient = useQueryClient();

  // --- REACT QUERY DATA PIPELINES (5-min SWR cache, instant 0ms reload) ---
  const songsQuery = useQuery({
    queryKey: ["homepage-songs"],
    queryFn: getSongs,
    staleTime: 1000 * 60 * 15,
    gcTime: 1000 * 60 * 60,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });

  const trendingQuery = useQuery({
    queryKey: ["homepage-trending"],
    queryFn: getTrendingSongs,
    staleTime: 1000 * 60 * 15,
    gcTime: 1000 * 60 * 60,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });

  const heroQuery = useQuery({
    queryKey: ["homepage-hero-config"],
    queryFn: async () => {
      try {
        const [settings, dayIds, nightIds] = await Promise.all([
          getHeroSettings().catch(() => DEFAULT_HERO_SETTINGS),
          getHeroSongsRecords("day").catch(() => []),
          getHeroSongsRecords("night").catch(() => []),
        ]);
        return {
          settings: settings ?? DEFAULT_HERO_SETTINGS,
          dayIds: dayIds ?? [],
          nightIds: nightIds ?? [],
        };
      } catch {
        return {
          settings: DEFAULT_HERO_SETTINGS,
          dayIds: [],
          nightIds: [],
        };
      }
    },
    staleTime: 1000 * 60 * 15,
    gcTime: 1000 * 60 * 60,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });

  const [heroLabel, setHeroLabel] = useState("Today's Pick");

  const databaseSongs = songsQuery.data ?? [];
  const databaseTrendingSongs = trendingQuery.data ?? [];
  const heroSettings = heroQuery.data?.settings ?? DEFAULT_HERO_SETTINGS;
  const manualDaySongIds = heroQuery.data?.dayIds ?? [];
  const manualNightSongIds = heroQuery.data?.nightIds ?? [];

  // Update Hero Period label periodically without trigger refetch
  useEffect(() => {
    const updateLabel = () => {
      const periodInfo = getCurrentHeroPeriod(heroSettings);
      setHeroLabel(periodInfo.label);
    };
    updateLabel();
    const interval = setInterval(updateLabel, 60000);
    return () => clearInterval(interval);
  }, [heroSettings]);

  // Realtime Supabase Channel -> marks caches as stale safely
  useEffect(() => {
    return subscribeToRealtimeChanges("homepage-realtime-sync", [
      {
        table: "songs",
        callback: () => {
          void queryClient.invalidateQueries({ queryKey: ["homepage-songs"], refetchType: "none" });
          void queryClient.invalidateQueries({
            queryKey: ["homepage-trending"],
            refetchType: "none",
          });
        },
      },
      {
        table: "trending_songs",
        callback: () => {
          void queryClient.invalidateQueries({
            queryKey: ["homepage-trending"],
            refetchType: "none",
          });
        },
      },
      {
        table: "home_hero_settings",
        callback: () => {
          void queryClient.invalidateQueries({
            queryKey: ["homepage-hero-config"],
            refetchType: "none",
          });
        },
      },
      {
        table: "home_hero_songs",
        callback: () => {
          void queryClient.invalidateQueries({
            queryKey: ["homepage-hero-config"],
            refetchType: "none",
          });
        },
      },
    ]);
  }, [queryClient]);

  const convertedDatabaseSongs = useMemo(
    () => databaseSongs.map((song) => databaseSongToPlayerSong(song)),
    [databaseSongs],
  );

  useEffect(() => {
    if (convertedDatabaseSongs.length > 0) {
      replaceRuntimeSongs(convertedDatabaseSongs);
    }
  }, [convertedDatabaseSongs]);

  const uploadedSongsBySection = useMemo(() => {
    const result: Record<SectionId, PlayerSong[]> = {
      bangla: [],
      favourite: [],
      hindi: [],
      english: [],
      global: [],
      "boost-aura": [],
    };

    for (const song of convertedDatabaseSongs) {
      if (belongsToSection(song, "bangla")) result.bangla.push(song);
      if (belongsToSection(song, "favourite")) result.favourite.push(song);
      if (belongsToSection(song, "hindi")) result.hindi.push(song);
      if (belongsToSection(song, "english")) result.english.push(song);
      if (belongsToSection(song, "global")) result.global.push(song);
      if (belongsToSection(song, "boost-aura")) result["boost-aura"].push(song);
    }

    return result;
  }, [convertedDatabaseSongs]);

  const trendingSongs = useMemo(
    () => databaseTrendingSongs.map((song) => databaseSongToPlayerSong(song, { trending: true })),
    [databaseTrendingSongs],
  );

  const [rankingVersion, setRankingVersion] = useState(0);

  // Re-evaluate feed ranking whenever playback events occur (e.g. play completions, song changes) or on window focus
  useEffect(() => {
    const bump = () => setRankingVersion((v) => v + 1);

    const unsubs = [
      playbackEvents.on("PLAY", bump),
      playbackEvents.on("SONG_CHANGE", bump),
      playbackEvents.on("QUEUE_ENDED", bump),
      playbackEvents.on("LIKE", bump),
      playbackEvents.on("UNLIKE", bump),
    ];

    const onFocus = () => bump();
    window.addEventListener("focus", onFocus);

    return () => {
      for (const unsub of unsubs) unsub();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const displayedTrendingSongs = useMemo(
    () => rankSectionTracks(trendingSongs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trendingSongs, rankingVersion],
  );

  const sectionRows = useMemo(
    () => rankHomeSections(sections, uploadedSongsBySection),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uploadedSongsBySection, rankingVersion],
  );

  const manualHeroSongs = useMemo(() => {
    if (heroSettings.mode !== "manual") return undefined;
    const periodInfo = getCurrentHeroPeriod(heroSettings);
    const ids = periodInfo.period === "day" ? manualDaySongIds : manualNightSongIds;
    if (ids.length === 0) return undefined;
    const songMap = new Map(convertedDatabaseSongs.map((s) => [s.id, s]));
    const found = ids.map((id) => songMap.get(id)).filter(Boolean) as PlayerSong[];
    return found.length > 0 ? found : undefined;
  }, [
    heroSettings.mode,
    heroSettings,
    manualDaySongIds,
    manualNightSongIds,
    convertedDatabaseSongs,
  ]);

  const isAnythingLoading = songsQuery.isLoading || trendingQuery.isLoading || heroQuery.isLoading;
  const loadError = songsQuery.error instanceof Error ? songsQuery.error.message : "";
  const trendingLoadError = trendingQuery.error instanceof Error ? trendingQuery.error.message : "";
  const anyError = loadError || trendingLoadError;

  // Show full pixel-perfect skeleton on initial cold load
  if (isAnythingLoading && databaseSongs.length === 0) {
    return <HomepageSkeleton />;
  }

  return (
    <div className="relative">
      {/* HERO BANNER */}
      <div>
        {convertedDatabaseSongs.length > 0 ? (
          <HeroBanner
            catalogue={convertedDatabaseSongs}
            sections={sections}
            songsBySection={uploadedSongsBySection}
            manualSongs={manualHeroSongs}
            autoRotate={heroSettings.rotation_enabled}
            intervalSeconds={heroSettings.rotation_interval_seconds || 5}
          />
        ) : isAnythingLoading ? (
          <HeroBannerSkeleton />
        ) : null}
      </div>

      {/* ERRORS */}
      {anyError && (
        <div className="px-3 py-2 sm:px-6 md:px-12">
          <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs font-medium text-red-400">
            {loadError ? `Songs: ${loadError} ` : ""}
            {trendingLoadError ? `Trending: ${trendingLoadError}` : ""}
          </p>
        </div>
      )}

      {/* SECTIONS */}
      <div className="space-y-6 pt-6 sm:space-y-10 sm:pt-8 lg:space-y-12 lg:pt-10">
        {displayedTrendingSongs.length > 0 && (
          <SectionRow section={trendingSection} songs={displayedTrendingSongs} />
        )}

        {sectionRows.map(
          ({ section, songs }) =>
            songs.length > 0 && <SectionRow key={section.id} section={section} songs={songs} />,
        )}

        {recent.length > 0 && <SectionRow section={recentlyPlayedSection} songs={recent} />}
      </div>
    </div>
  );
}
