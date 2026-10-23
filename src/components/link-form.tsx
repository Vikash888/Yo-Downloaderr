"use client";

import { ArrowRight, Clipboard, LoaderCircle, Link2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";

export function LinkForm({
  value,
  onChange,
  onSubmit,
  loading,
  error,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (url: string) => Promise<void>;
  loading: boolean;
  error: string | null;
  compact?: boolean;
}) {
  const [clipboardNote, setClipboardNote] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit(value);
  };
  const paste = async () => {
    setClipboardNote(null);
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setClipboardNote("Your clipboard is empty.");
        return;
      }
      onChange(text.trim());
      setClipboardNote("Link pasted. Ready to fetch.");
    } catch {
      setClipboardNote("Clipboard access was blocked. Use Ctrl+V or long-press to paste.");
    }
  };
  return (
    <div className={`link-form-wrap ${compact ? "compact" : ""}`}>
      <form className="link-form" onSubmit={submit} noValidate>
        <label htmlFor={compact ? "playlist-url-compact" : "playlist-url"} className="sr-only">YouTube playlist or video URL</label>
        <Link2 className="input-link-icon" size={20} aria-hidden="true" />
        <input
          id={compact ? "playlist-url-compact" : "playlist-url"}
          type="url"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="https://youtube.com/playlist?list=…"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={loading}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "link-error" : "link-guidance"}
        />
        <button className="paste-button" type="button" onClick={() => void paste()} disabled={loading}>
          <Clipboard size={16} /> <span>Paste</span>
        </button>
        <button className="fetch-button" type="submit" disabled={loading || !value.trim()}>
          {loading ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}
          <span>{loading ? "Reading playlist" : "Fetch playlist"}</span>
        </button>
      </form>
      <div className="form-messages">
        {error ? <p className="form-error" id="link-error" role="alert">{error}</p> : (
          <p className="form-guidance" id="link-guidance"><ShieldCheck size={14} /> YouTube playlists and single videos · up to 200 items · no account needed</p>
        )}
        {clipboardNote && <p className="clipboard-note" role="status">{clipboardNote}</p>}
      </div>
    </div>
  );
}
