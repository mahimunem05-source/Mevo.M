import type { Song } from "@/data/songs";
import {
  saveOfflineSong,
  removeOfflineSong,
  getOfflineSong,
  getAllOfflineSongs,
  clearAllOfflineStorage,
} from "./offlineStorage";
import type { DownloadedTrack } from "@/types/download";
import { toast } from "sonner";

type StatusListener = () => void;

class DownloadService {
  private activeControllers = new Map<string, AbortController>();
  private activeProgress = new Map<string, number>();
  private listeners = new Set<StatusListener>();

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  getProgress(songId: string): number {
    return this.activeProgress.get(songId) ?? 0;
  }

  isDownloading(songId: string): boolean {
    return this.activeControllers.has(songId);
  }

  async isDownloaded(songId: string): Promise<boolean> {
    const song = await getOfflineSong(songId);
    return song !== null;
  }

  async startDownload(song: Song): Promise<void> {
    if (this.isDownloading(song.id)) return;

    const alreadyDownloaded = await this.isDownloaded(song.id);
    if (alreadyDownloaded) {
      toast("Already Downloaded", {
        duration: 2000,
        id: `download-already-${song.id}`,
      });
      return;
    }

    const controller = new AbortController();
    this.activeControllers.set(song.id, controller);
    this.activeProgress.set(song.id, 0);
    this.notify();

    try {
      const res = await fetch(song.audio, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);

      const contentLength = Number(res.headers.get("content-length")) || 0;
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No readable stream");

      const chunks: BlobPart[] = [];
      let received = 0;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          const pct = contentLength ? Math.round((received / contentLength) * 100) : 50;
          this.activeProgress.set(song.id, pct);
          this.notify();
        }
      }

      const blob = new Blob(chunks, { type: "audio/mpeg" });
      await saveOfflineSong(song, blob);

      // Trigger browser file download directly to default Android/PC Downloads folder
      if (typeof window !== "undefined") {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${song.title} - ${song.artist}.mp3`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }

      toast.success("Downloaded Successfully", {
        duration: 2500,
        id: `download-success-${song.id}`,
      });
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Download failed:", err);
        toast.error(`Download failed: ${err.message || "Network error"}`, {
          duration: 2500,
          id: "download-error-toast",
        });
      }
    } finally {
      this.activeControllers.delete(song.id);
      this.activeProgress.delete(song.id);
      this.notify();
    }
  }

  cancelDownload(songId: string): void {
    const controller = this.activeControllers.get(songId);
    if (controller) {
      controller.abort();
    }
  }

  async removeDownload(song: Song): Promise<void> {
    try {
      await removeOfflineSong(song.id);
      this.notify();
    } catch (err) {
      toast.error("Could not remove download.", {
        duration: 2500,
        id: "download-error-toast",
      });
    }
  }

  async clearAllDownloads(): Promise<void> {
    try {
      await clearAllOfflineStorage();
      this.notify();
    } catch (err) {
      toast.error("Could not clear downloads.", {
        duration: 2500,
        id: "download-error-toast",
      });
    }
  }

  async getAllDownloadedTracks(): Promise<DownloadedTrack[]> {
    return getAllOfflineSongs();
  }
}

export const downloadService = new DownloadService();
