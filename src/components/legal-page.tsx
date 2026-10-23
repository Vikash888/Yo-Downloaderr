import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/site-header";

export function LegalPage({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: ReactNode }) {
  return (
    <main className="inner-page legal-page">
      <SiteHeader />
      <div className="section-shell legal-shell">
        <Link href="/" className="text-button"><ArrowLeft size={16} />Back to downloader</Link>
        <header className="legal-header"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{intro}</p><span>Yo Download · Policy version 1.0</span></header>
        <div className="legal-layout"><aside><nav aria-label="Legal pages"><Link href="/terms">Terms of use</Link><Link href="/privacy">Privacy policy</Link><Link href="/copyright">Copyright & takedown</Link></nav><div><ShieldCheck size={20} /><p>These policies are product information, not legal advice.</p></div></aside><article className="legal-content">{children}</article></div>
      </div>
      <footer className="simple-footer section-shell"><span>yo/download</span><div><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/copyright">Copyright</Link></div></footer>
    </main>
  );
}

export function LegalSection({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return <section><span className="legal-number">{number}</span><h2>{title}</h2>{children}</section>;
}
