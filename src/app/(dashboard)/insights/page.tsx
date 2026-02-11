import { AskData } from "@/components/insights/ask-data";
import { RecentInsights } from "@/components/insights/recent-insights";
import { SessionStories } from "@/components/insights/session-stories";

export const dynamic = "force-dynamic";

export default function InsightsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">AI Insights</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ask questions about your prompt history, explore session narratives,
          and discover patterns in your coding workflow.
        </p>
      </div>

      {/* Section 1: Ask Your Data */}
      <AskData />

      {/* Section 2: Recent Insights */}
      <RecentInsights />

      {/* Section 3: Session Stories */}
      <SessionStories />
    </div>
  );
}
