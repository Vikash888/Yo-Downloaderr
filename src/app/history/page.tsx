import type { Metadata } from "next";
import { HistoryView } from "@/components/history-view";

export const metadata: Metadata = { title: "Recent downloads · Yo Download", description: "Return to recent playlist jobs in this browser." };

export default function HistoryPage() {
  return <HistoryView />;
}
