import { UploadPanel } from "@/components/upload-panel";
import { RecentAnalyses } from "@/components/recent-analyses";
import { Card } from "@/components/ui";

export default function HomePage() {
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">Support Bundle Analyzer</h1>
        <p className="text-[var(--muted)]">
          Загрузите архив поддержки для автоматического анализа и диагностики проблем
        </p>
      </div>

      <Card className="p-6">
        <UploadPanel />
      </Card>

      <RecentAnalyses />
    </div>
  );
}
