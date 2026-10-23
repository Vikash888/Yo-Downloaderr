"use client";

import Link from "next/link";
import { ArrowDownToLine, History, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { safeSetStorage } from "@/lib/client-owner";

export function SiteHeader() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    safeSetStorage("yo-theme", next);
  };
  return (
    <header className="site-header">
      <Link href="/" className="wordmark" aria-label="Yo Download home">
        <span className="wordmark-icon"><ArrowDownToLine size={18} strokeWidth={2.5} /></span>
        <span>yo<span>/</span>download</span>
      </Link>
      <nav className="header-nav" aria-label="Main navigation">
        <a href="#how-it-works">How it works</a>
        <a href="#questions">Questions</a>
        <Link href="/history" className="header-history"><History size={16} /> <span>History</span></Link>
        <button className="icon-button" type="button" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </nav>
    </header>
  );
}
