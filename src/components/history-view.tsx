"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, CheckCheck, CircleAlert, Clock3, History, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { clearLocalHistory, readLocalHistory } from "@/lib/history-store";
import type { LocalHistoryEntry } from "@/lib/history-store";

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function HistoryView() {
  const [runs, setRuns] = useState<LocalHistoryEntry[]>([]);
  const [filter, setFilter] = useState<"all" | "completed" | "attention">("all");

  useEffect(() => {
    setRuns(readLocalHistory());
  }, []);

  const filtered = useMemo(
    () =>
      runs.filter((run) => {
        if (filter === "completed") return run.done > 0;
        if (filter === "attention") return run.failed > 0;
        return true;
      }),
    [runs, filter],
  );

  const handleClear = () => {
    clearLocalHistory();
    setRuns([]);
  };

  return (
    <main className="inner-page history-page">
      <SiteHeader />
      <section className="section-shell history-shell">
        <Link href="/" className="text-button">
          <ArrowLeft size={16} /> Back to downloader
        </Link>
        <div className="inner-hero">
          <p className="eyebrow">Stored privately in your browser</p>
          <h1>
            Recent
            <br />
            <span>playlists.</span>
          </h1>
          <p>
            Re-open and download any recent playlist in one click. History is stored locally on your device so it works even on stateless cloud deployments with no account.
          </p>
        </div>

        <div className="history-privacy">
          <ShieldCheck size={20} />
          <p>Nothing in your history is uploaded to a public server—clearing browser data or clicking Clear removes it immediately.</p>
        </div>

        <div className="history-toolbar">
          <div>
            <History size={20} />
            <strong>
              {runs.length} recent {runs.length === 1 ? "playlist" : "playlists"}
            </strong>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div className="job-filter" role="group" aria-label="Filter download history">
              <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
                All
              </button>
              <button className={filter === "completed" ? "active" : ""} onClick={() => setFilter("completed")}>
                Completed
              </button>
              <button className={filter === "attention" ? "active" : ""} onClick={() => setFilter("attention")}>
                Had failures
              </button>
            </div>
            {runs.length > 0 && (
              <button type="button" className="cancel-button" onClick={handleClear}>
                <Trash2 size={14} /> Clear history
              </button>
            )}
          </div>
        </div>

        {filtered.length ? (
          <div className="history-list">
            {filtered.map((run, index) => {
              const pct = run.totalSelected > 0 ? Math.round((run.done / run.totalSelected) * 100) : 0;
              return (
                <motion.article
                  className="history-card"
                  key={run.id}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.04, 0.25) }}
                >
                  <div className="history-card-top">
                    <span className={`history-status ${run.status === "completed" ? "completed" : run.status === "failed" ? "failed" : ""}`}>
                      {run.status === "completed" ? (
                        <CheckCheck size={15} />
                      ) : run.status === "failed" ? (
                        <CircleAlert size={15} />
                      ) : (
                        <Clock3 size={15} />
                      )}
                      {run.status}
                    </span>
                    <time dateTime={run.createdAt}>{dateLabel(run.createdAt)}</time>
                  </div>
                  <h2>{run.title}</h2>
                  <p className="history-channel">{run.channel}</p>
                  <div className="history-meta">
                    <span>
                      {run.options.format.toUpperCase()} · {run.options.quality}
                      {run.options.format === "mp4" ? "p" : " kbps"}
                    </span>
                    <span>{run.done} done</span>
                    <span>{run.failed} failed</span>
                    <span>{run.skipped} skipped</span>
                  </div>
                  <div className="history-progress">
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <div className="history-card-actions">
                    <span className="history-expired">{run.options.delivery === "zip" ? "ZIP mode" : "Direct files mode"}</span>
                    <div>
                      <Link href={`/?url=${encodeURIComponent(run.sourceUrl)}`} className="text-button">
                        <RotateCcw size={15} /> Load &amp; download again
                      </Link>
                    </div>
                  </div>
                </motion.article>
              );
            })}
          </div>
        ) : (
          <div className="history-empty">
            <History size={34} />
            <h2>{runs.length ? "Nothing in this filter" : "No downloads yet"}</h2>
            <p>{runs.length ? "Switch filters to view your recent playlists." : "Playlists you download will appear here for quick 1-click re-runs."}</p>
            {runs.length ? (
              <button className="secondary-action" onClick={() => setFilter("all")}>
                Show all
              </button>
            ) : (
              <Link href="/" className="primary-action">
                Paste your first playlist <ArrowRight size={18} />
              </Link>
            )}
          </div>
        )}
      </section>
      <footer className="simple-footer section-shell">
        <span>yo/download</span>
        <div>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/copyright">Copyright</Link>
        </div>
      </footer>
    </main>
  );
}
