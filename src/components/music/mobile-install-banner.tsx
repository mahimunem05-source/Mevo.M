import { useEffect, useState, useCallback, memo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Download, X, Sparkles, Share, PlusSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const DISMISS_STORAGE_KEY = "mevo-install-banner-dismissed";

export const MobileInstallBanner = memo(function MobileInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. Check if already installed as standalone PWA
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as unknown as { standalone?: boolean }).standalone) ||
      document.referrer.includes("android-app://");

    if (isStandalone) {
      setIsVisible(false);
      return;
    }

    // 2. Check if previously dismissed in this session
    try {
      if (sessionStorage.getItem(DISMISS_STORAGE_KEY) === "1") {
        setIsVisible(false);
        return;
      }
    } catch {
      // Storage unavailable
    }

    // 3. Detect mobile device
    const userAgent = navigator.userAgent || navigator.vendor || (window as unknown as { opera?: string }).opera || "";
    const isMobileDevice =
      /android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent) ||
      (window.innerWidth < 768 && "ontouchstart" in window);

    const isIosDevice = /iphone|ipad|ipod/i.test(userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
    setIsIos(isIosDevice);

    if (!isMobileDevice) {
      setIsVisible(false);
      return;
    }

    // On mobile devices, show banner
    setIsVisible(true);

    // 4. Capture native 'beforeinstallprompt' event (Chromium, Android, Edge, Chrome)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsVisible(true);
    };

    const handleAppInstalled = () => {
      setIsVisible(false);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    setShowIosGuide(false);
    try {
      sessionStorage.setItem(DISMISS_STORAGE_KEY, "1");
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === "accepted") {
          setIsVisible(false);
        }
        setDeferredPrompt(null);
      } catch (err) {
        console.warn("Native PWA prompt error:", err);
      }
    } else if (isIos) {
      // Show elegant iOS Add-to-Home-Screen instructions
      setShowIosGuide((prev) => !prev);
    } else {
      // Fallback: notify how to add on generic mobile browsers
      setShowIosGuide((prev) => !prev);
    }
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="mobile-pwa-install-banner"
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="sticky top-0 z-50 w-full overflow-hidden border-b border-[#4FD1C5]/20 bg-[#071114]/95 shadow-[0_4px_24px_rgba(0,0,0,0.6)] backdrop-blur-xl md:hidden"
        >
          {/* Subtle top neon ambient glow */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 h-16 w-3/4 rounded-full bg-[#4FD1C5]/15 blur-2xl"
          />

          <div className="relative mx-auto flex max-w-lg items-center justify-between gap-3 px-3 py-2 sm:px-4 sm:py-2.5">
            {/* App Icon + Information */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative size-9 shrink-0 overflow-hidden rounded-xl border border-[#4FD1C5]/30 bg-[#121E23] shadow-[0_0_12px_rgba(79,209,197,0.25)]">
                <img
                  src="/favicon.png"
                  alt="MEVO App Icon"
                  width={36}
                  height={36}
                  className="size-full object-cover"
                />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-extrabold tracking-tight text-white">
                    MEVO Music
                  </span>
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-[#4FD1C5]/15 border border-[#4FD1C5]/30 px-1.5 py-0.2 text-[8px] font-bold text-[#4FD1C5]">
                    <Sparkles className="size-2 text-[#4FD1C5]" />
                    <span>APP</span>
                  </span>
                </div>
                <p className="truncate text-[10px] font-medium text-white/60">
                  Full-screen & native sound
                </p>
              </div>
            </div>

            {/* Actions: Install CTA + Close button */}
            <div className="flex items-center gap-1.5 shrink-0">
              <motion.button
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={handleInstallClick}
                className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#4FD1C5] to-[#38B2AC] px-3.5 py-1.5 text-xs font-bold text-[#071012] shadow-[0_2px_10px_rgba(79,209,197,0.35)] transition-all hover:brightness-110 active:brightness-95 cursor-pointer"
              >
                <Download className="size-3.5 stroke-[2.5]" />
                <span>Install</span>
              </motion.button>

              <button
                type="button"
                aria-label="Dismiss app banner"
                onClick={handleDismiss}
                className="grid size-7 place-items-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>

          {/* iOS / Generic Fallback Installation Micro-Guide */}
          <AnimatePresence>
            {showIosGuide && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="overflow-hidden border-t border-white/10 bg-[#0B1519] px-4 py-2.5 text-[11px] text-white/80"
              >
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-[#4FD1C5]/20 text-[#4FD1C5]">
                    {isIos ? <Share className="size-3" /> : <PlusSquare className="size-3" />}
                  </div>
                  <div className="flex-1 space-y-0.5">
                    <p className="font-bold text-white">To install on your home screen:</p>
                    <p className="text-white/70">
                      {isIos ? (
                        <>
                          Tap <span className="font-semibold text-[#4FD1C5]">Share</span> (at the
                          bottom of Safari), then tap{" "}
                          <span className="font-semibold text-[#4FD1C5]">
                            &ldquo;Add to Home Screen&rdquo;
                          </span>
                          .
                        </>
                      ) : (
                        <>
                          Tap your browser&rsquo;s <span className="font-semibold text-[#4FD1C5]">menu (⋮)</span>{" "}
                          and choose <span className="font-semibold text-[#4FD1C5]">&ldquo;Install app&rdquo;</span> or{" "}
                          <span className="font-semibold text-[#4FD1C5]">&ldquo;Add to Home screen&rdquo;</span>.
                        </>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowIosGuide(false)}
                    className="text-white/40 hover:text-white text-[10px] uppercase font-bold"
                  >
                    Got it
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
