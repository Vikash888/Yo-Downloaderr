"use client";

import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Archive, ArrowDown, ArrowDownToLine, Check, FileAudio, FileVideo, ListMusic, MousePointer2, PackageCheck, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LinkForm } from "@/components/link-form";
import { PackagingScene, Questions, ReliabilityStrip, SiteFooter, UseCases } from "@/components/marketing";
import { PlaylistWorkspace } from "@/components/playlist-workspace";
import { SiteHeader } from "@/components/site-header";
import { safeGetStorage, safeSetStorage } from "@/lib/client-owner";
import { DEFAULT_OPTIONS } from "@/lib/types";
import type { DownloadOptions, PlaylistPreview } from "@/lib/types";

const OPTIONS_KEY = "yo-options-v1";
const COOKIES_STORAGE_KEY = "yo-user-cookies";

export function YoDownloadApp() {
  const heroRef = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const { scrollYProgress: heroProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroY = useTransform(heroProgress, [0, 1], [0, 190]);
  const heroScale = useTransform(heroProgress, [0, 1], [1, 0.78]);
  const heroRotate = useTransform(heroProgress, [0, 1], [0, 7]);
  const backdropScale = useTransform(heroProgress, [0, 1], [1, 1.22]);
  const backdropClip = useTransform(heroProgress, [0, 1], ["inset(0% 0% 0% 0% round 0px)", "inset(7% 4% 0% 4% round 90px)"]);
  const headlineY = useTransform(heroProgress, [0, 1], [0, -80]);

  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<PlaylistPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [options, setOptions] = useState<DownloadOptions>({
    ...DEFAULT_OPTIONS,
    delivery: "individual",
  });
  const [settingsReady, setSettingsReady] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const scrollToWorkspace = useCallback(() => {
    window.setTimeout(
      () =>
        document.getElementById("workspace")?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
          block: "start",
        }),
      80,
    );
  }, []);

  const fetchPlaylist = useCallback(
    async (input: string) => {
      if (!input.trim()) {
        setFetchError("Paste a YouTube playlist or video link to get started.");
        return;
      }
      setFetching(true);
      setFetchError(null);
      try {
        const storedCookies = safeGetStorage(COOKIES_STORAGE_KEY) || "";
        const response = await fetch("/api/playlist/info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: input.trim(),
            cookies: storedCookies || undefined,
          }),
        });
        const body = (await response.json()) as { preview?: PlaylistPreview; error?: string };
        if (!response.ok || !body.preview) {
          throw new Error(body.error || "We couldn't load that playlist. Check the link and try again.");
        }
        setPreview(body.preview);
        setSelected(new Set(body.preview.entries.filter((entry) => entry.available).map((entry) => entry.selectionKey)));
        setUrl(body.preview.sourceUrl);
        scrollToWorkspace();
      } catch (error) {
        setFetchError(error instanceof Error ? error.message : "We couldn't load that playlist.");
      } finally {
        setFetching(false);
      }
    },
    [scrollToWorkspace],
  );

  useEffect(() => {
    try {
      const saved = safeGetStorage(OPTIONS_KEY);
      if (saved) setOptions({ ...DEFAULT_OPTIONS, delivery: "individual", ...(JSON.parse(saved) as Partial<DownloadOptions>) });
    } catch {
      /* ignore invalid JSON */
    }
    setSettingsReady(true);

    const params = new URLSearchParams(window.location.search);
    const queryUrl = params.get("url")?.trim();
    if (queryUrl) {
      setUrl(queryUrl);
      void fetchPlaylist(queryUrl);
    }
  }, [fetchPlaylist]);

  useEffect(() => {
    if (settingsReady) safeSetStorage(OPTIONS_KEY, JSON.stringify(options));
  }, [options, settingsReady]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const resetWorkspace = () => {
    setPreview(null);
    setSelected(new Set());
    setFetchError(null);
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <main>
      <motion.div className="page-progress" style={{ scaleX: scrollYProgress }} />
      <SiteHeader />
      <section className="hero" ref={heroRef} aria-labelledby="hero-title">
        <motion.div className="hero-backdrop" style={reduced ? undefined : { scale: backdropScale, clipPath: backdropClip }}>
          <div className="hero-grid" />
          <div className="ambient-orb orb-one" />
          <div className="ambient-orb orb-two" />
        </motion.div>
        <div className="hero-inner section-shell">
          <motion.div className="hero-copy" style={reduced ? undefined : { y: headlineY }}>
            <motion.p
              className="hero-kicker"
              initial={reduced ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              <span /> Snaptube-fast playlist &amp; video downloads · Cloud anti-bot built in
            </motion.p>
            <h1 id="hero-title" aria-label="The whole playlist. One click.">
              {["THE WHOLE", "PLAYLIST.", "ONE CLICK."].map((line, index) => (
                <span className={`headline-mask line-${index}`} key={line}>
                  <motion.span
                    initial={reduced ? false : { y: "110%", rotate: 2 }}
                    animate={{ y: 0, rotate: 0 }}
                    transition={{ duration: 0.9, delay: 0.12 + index * 0.1, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {line}
                  </motion.span>
                </span>
              ))}
            </h1>
            <motion.p
              className="hero-description"
              initial={reduced ? false : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55, duration: 0.6 }}
            >
              Paste any YouTube playlist or video link, tap instant 1-click MP3/MP4 on any track, or grab the entire playlist as direct files or one ordered ZIP.
            </motion.p>
            <motion.div initial={reduced ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.67, duration: 0.6 }}>
              <LinkForm value={url} onChange={setUrl} onSubmit={fetchPlaylist} loading={fetching} error={fetchError} />
              <div className="hero-trust">
                <span>
                  <Check size={14} /> No sign-up
                </span>
                <span>
                  <Check size={14} /> BotGuard PO-Token anti-bot
                </span>
                <span>
                  <Check size={14} /> Free Render &amp; localhost ready
                </span>
              </div>
            </motion.div>
          </motion.div>

          <motion.div
            className="hero-machine-wrap"
            style={reduced ? undefined : { y: heroY, scale: heroScale, rotate: heroRotate }}
            initial={reduced ? false : { opacity: 0, scale: 0.86, rotate: -5 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ delay: 0.35, duration: 1, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="machine-orbit orbit-a" />
            <div className="machine-orbit orbit-b" />
            <div className="format-float float-mp4">
              <FileVideo size={17} />
              <span>
                MP4<small>up to 1080p</small>
              </span>
            </div>
            <div className="format-float float-mp3">
              <FileAudio size={17} />
              <span>
                MP3<small>up to 320 kbps</small>
              </span>
            </div>
            <div className="hero-machine">
              <div className="machine-header">
                <span>
                  <ListMusic size={17} /> YOUR PLAYLIST
                </span>
                <MousePointer2 size={17} />
              </div>
              <div className="machine-list">
                <div>
                  <b>01</b>
                  <i />
                  <span />
                </div>
                <div>
                  <b>02</b>
                  <i />
                  <span />
                </div>
                <div>
                  <b>03</b>
                  <i />
                  <span />
                </div>
                <div>
                  <b>04</b>
                  <i />
                  <span />
                </div>
              </div>
              <div className="machine-transform">
                <span />
                <ArrowDownToLine size={24} />
                <span />
              </div>
              <div className="machine-package">
                <PackageCheck size={32} />
                <div>
                  <strong>DIRECT STREAM</strong>
                  <small>Instant. Ordered. Yours.</small>
                </div>
                <Archive size={20} />
              </div>
            </div>
            <div className="machine-caption">
              <span className="live-dot" /> STATELESS ANTI-BOT ENGINE <b>01 — 200</b>
            </div>
          </motion.div>
        </div>
        <div className="hero-bottom section-shell">
          <div className="how-strip">
            <span>
              <b>01</b> Paste &amp; fetch
            </span>
            <span>
              <b>02</b> 1-click MP3 / MP4
            </span>
            <span>
              <b>03</b> Save files or ZIP
            </span>
          </div>
          <a href="#how-it-works" className="scroll-cue">
            <span>See how it works</span>
            <ArrowDown size={17} />
          </a>
        </div>
      </section>

      <AnimatePresence mode="wait">
        {preview && (
          <PlaylistWorkspace
            key={`preview-${preview.previewId}`}
            preview={preview}
            selected={selected}
            onSelectedChange={setSelected}
            options={options}
            onOptionsChange={setOptions}
            onBack={resetWorkspace}
            onToast={setToast}
          />
        )}
      </AnimatePresence>

      <PackagingScene />
      <UseCases />
      <ReliabilityStrip />
      <section className="rights-banner section-shell">
        <RevealRights />
      </section>
      <Questions />
      <SiteFooter />
      <AnimatePresence>
        {toast && (
          <motion.div
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
          >
            <Check size={17} />
            <span>{toast}</span>
            <button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification">
              <X size={15} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

function RevealRights() {
  return (
    <motion.div
      className="rights-banner-inner"
      initial={{ opacity: 0, y: 25 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
    >
      <ShieldCheck size={35} />
      <div>
        <p className="eyebrow">A necessary pause</p>
        <h2>Download rights don’t come in a ZIP.</h2>
        <p>
          Use this tool only for your own uploads, explicitly permitted content, or material whose license allows downloading. YouTube’s terms and local copyright law still apply.
        </p>
      </div>
      <a href="/copyright">
        Read the content policy
        <ArrowDown className="arrow-up-right" size={18} />
      </a>
    </motion.div>
  );
}
