"use client";

import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Archive, AudioLines, Check, ChevronDown, Clapperboard, CloudOff, FileMusic, GraduationCap, ListChecks, Plane, RefreshCw, ShieldCheck, TimerReset, UserRoundCheck } from "lucide-react";
import { useRef, useState } from "react";
import Link from "next/link";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";

export function PackagingScene() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const converge = useTransform(scrollYProgress, [0.12, 0.53], [0, 1]);
  const leftX = useTransform(converge, [0, 1], [-260, 0]);
  const rightX = useTransform(converge, [0, 1], [260, 0]);
  const outerY = useTransform(converge, [0, 1], [100, 0]);
  const middleY = useTransform(converge, [0, 1], [190, 0]);
  const leftRotate = useTransform(converge, [0, 1], [-9, 0]);
  const rightRotate = useTransform(converge, [0, 1], [9, 0]);
  const packageScale = useTransform(scrollYProgress, [0.5, 0.7], [0.82, 1]);
  const packageOpacity = useTransform(scrollYProgress, [0.42, 0.58], [0, 1]);
  const lineScale = useTransform(scrollYProgress, [0.25, 0.65], [0, 1]);

  return (
    <section className="packaging-scene" ref={ref} id="how-it-works" aria-labelledby="process-title">
      <div className="packaging-sticky section-shell">
        <Reveal className="scene-copy">
          <p className="eyebrow">The whole list, without the busywork</p>
          <h2 id="process-title">Three choices in.<br /><span>One tidy package out.</span></h2>
          <p>Yo Download keeps the order, names every file, and tells you exactly what happened along the way.</p>
        </Reveal>
        <div className={`convergence-stage ${reduced ? "reduced" : ""}`} aria-label="Format, quality and selection become an ordered download package">
          <motion.div className="converge-line" style={reduced ? undefined : { scaleX: lineScale }} />
          <motion.div className="decision-card decision-format" style={reduced ? undefined : { x: leftX, y: outerY, rotate: leftRotate }}>
            <span className="decision-number">01</span><Clapperboard size={24} />
            <div><strong>Format</strong><small>MP4 · MP3 · M4A</small></div>
          </motion.div>
          <motion.div className="decision-card decision-quality" style={reduced ? undefined : { y: middleY }}>
            <span className="decision-number">02</span><AudioLines size={24} />
            <div><strong>Quality</strong><small>360p to 1080p · 128 to 320 kbps</small></div>
          </motion.div>
          <motion.div className="decision-card decision-select" style={reduced ? undefined : { x: rightX, y: outerY, rotate: rightRotate }}>
            <span className="decision-number">03</span><ListChecks size={24} />
            <div><strong>Selection</strong><small>Keep every item—or only what you need</small></div>
          </motion.div>
          <motion.div className="package-result" style={reduced ? undefined : { scale: packageScale, opacity: packageOpacity }}>
            <div className="package-top"><Archive size={27} /><span>YOUR PLAYLIST</span><Check size={18} /></div>
            <div className="package-file"><span>01</span><i /><i /></div>
            <div className="package-file"><span>02</span><i /><i /></div>
            <div className="package-file"><span>03</span><i /><i /></div>
            <p>Ordered. Named. Ready.</p>
          </motion.div>
        </div>
        <div className="process-notes">
          <span><b>01</b> Paste and preview</span><span><b>02</b> Pick and deselect</span><span><b>03</b> Download or retry</span>
        </div>
      </div>
    </section>
  );
}

const USE_CASES = [
  { icon: GraduationCap, number: "01", title: "Study without a signal", text: "Save a lecture series you’re authorized to keep, deselect optional readings, and preserve the course order in every filename.", tag: "MP4 · 720p · ZIP" },
  { icon: FileMusic, number: "02", title: "Take the long way home", text: "Turn your own or Creative Commons music playlist into tagged audio with cover art for a flight, commute, or patchy connection.", tag: "MP3 · 320 kbps · Cover art" },
  { icon: UserRoundCheck, number: "03", title: "Back up your own uploads", text: "Package a public playlist from your channel into an orderly local archive. Failed items stay separate so one upload doesn’t stop the rest.", tag: "MP4 · Best available · Retry" },
  { icon: Plane, number: "04", title: "Pack a tutorial library", text: "Choose only the lessons for your trip, skip unavailable entries automatically, and save each file separately when you don’t need a ZIP.", tag: "M4A · Individual files" },
];

export function UseCases() {
  return (
    <section className="use-cases section-shell" aria-labelledby="use-cases-title">
      <Reveal>
        <p className="eyebrow">Made for offline plans</p>
        <h2 id="use-cases-title" className="section-title">A long list is a plan.<br />Not a chore.</h2>
      </Reveal>
      <Stagger className="use-case-grid">
        {USE_CASES.map((item) => (
          <StaggerItem className="use-case" key={item.title}>
            <div className="use-case-top"><span>{item.number}</span><item.icon size={24} /></div>
            <h3>{item.title}</h3><p>{item.text}</p><small>{item.tag}</small>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}

export function ReliabilityStrip() {
  return (
    <section className="reliability section-shell" aria-labelledby="reliability-title">
      <Reveal className="reliability-heading">
        <p className="eyebrow">No black box</p>
        <h2 id="reliability-title">You see what the server sees.</h2>
        <p>Live status comes from the persisted job, not an invented browser timer. Refresh the page and pick up where you left off.</p>
      </Reveal>
      <Stagger className="reliability-grid">
        <StaggerItem><RefreshCw size={22} /><h3>Two automatic retries</h3><p>Transient failures are retried per video. Anything still failing gets its own manual Retry button.</p></StaggerItem>
        <StaggerItem><CloudOff size={22} /><h3>Unavailable means skipped</h3><p>Private, deleted, and inaccessible entries are labeled with a reason while the rest of the queue continues.</p></StaggerItem>
        <StaggerItem><TimerReset size={22} /><h3>One-hour file window</h3><p>Download links expire and generated media is removed after the window. Metadata-only job history remains in this browser.</p></StaggerItem>
        <StaggerItem><ShieldCheck size={22} /><h3>Rights check before every run</h3><p>Private, paid, DRM-protected, age-restricted, and members-only media are outside the supported scope.</p></StaggerItem>
      </Stagger>
    </section>
  );
}

const FAQS = [
  { q: "What am I allowed to download?", a: "Use Yo Download only for videos you own, content you have explicit permission to save, or appropriately licensed Creative Commons and public-domain material. You must confirm this before each job. YouTube’s Terms of Service and copyright law may restrict other downloads; a technical download button does not grant permission." },
  { q: "Why did YouTube block or rate-limit a fetch?", a: "YouTube can challenge data-center traffic, and extractor compatibility changes over time. Yo Download reports that failure honestly and does not fabricate a queue. Wait before retrying, and never use the service to bypass sign-in, age, regional, DRM, or payment controls." },
  { q: "What happens when a chosen quality is unavailable?", a: "The extractor asks for the best stream at or below your selected resolution, with a best-available fallback. Audio is converted to your chosen MP3 or M4A bitrate. Source quality cannot be improved by selecting a higher output setting." },
  { q: "Will my job survive a refresh?", a: "Yes. The active job ID is remembered locally and its authoritative state is stored on the server. Reopening the site in the same browser reconnects to live progress and completed file links until they expire." },
  { q: "How are files named inside the ZIP?", a: "Each entry starts with its original playlist position, followed by a sanitized title—for example, “07 - Lecture title.mp3”. Illegal filename characters are removed and the numbering preserves playback order." },
  { q: "Do I need an account? Where is my history?", a: "No account is required. A private, random browser cookie lets you return to jobs and see recent history on this device. It is not a cross-device account, and clearing site data removes that link to your history." },
];

export function Questions() {
  const [open, setOpen] = useState(0);
  return (
    <section className="questions section-shell" id="questions" aria-labelledby="questions-title">
      <Reveal className="questions-intro"><p className="eyebrow">Before you paste</p><h2 id="questions-title">Straight answers.</h2><p>Format details, file retention, extractor limits, and the important rights stuff.</p></Reveal>
      <div className="faq-list">
        {FAQS.map((item, index) => {
          const expanded = open === index;
          return (
            <div className={`faq-item ${expanded ? "open" : ""}`} key={item.q}>
              <h3><button type="button" onClick={() => setOpen(expanded ? -1 : index)} aria-expanded={expanded} aria-controls={`faq-${index}`}><span>{String(index + 1).padStart(2, "0")}</span>{item.q}<ChevronDown size={20} /></button></h3>
              <AnimatePresence initial={false}>
                {expanded && <motion.div id={`faq-${index}`} className="faq-answer" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}><p>{item.a}</p></motion.div>}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="section-shell footer-grid">
        <div><Link href="/" className="footer-brand">yo/download</Link><p>Paste a playlist link, pick a format,<br />get everything in one click.</p></div>
        <div className="footer-links"><p>Product</p><a href="#how-it-works">How it works</a><Link href="/history">Recent downloads</Link><a href="#questions">Questions</a></div>
        <div className="footer-links"><p>Policies</p><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/copyright">Copyright & takedown</Link></div>
        <div className="footer-note"><ShieldCheck size={22} /><p>For content you own or have permission to download. No ads. No account required.</p></div>
      </div>
      <div className="section-shell footer-bottom"><span>© {new Date().getFullYear()} Yo Download</span><span>Not affiliated with YouTube or Google.</span><span>Files expire after 1 hour.</span></div>
    </footer>
  );
}
