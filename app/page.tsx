import { ShieldCheck, Zap, Database, EyeOff } from "lucide-react";
import { UploadPanel } from "@/components/upload-panel";
import { RecentAnalyses } from "@/components/recent-analyses";
import { Card } from "@/components/ui";

const FEATURES = [
  {
    icon: Zap,
    title: "Авто-триаж",
    text: "Отделяет критичные проблемы от фонового шума по правилам и ИИ.",
  },
  {
    icon: Database,
    title: "База знаний",
    text: "Подтягивает решения из прошлых тикетов и документации (RAG).",
  },
  {
    icon: ShieldCheck,
    title: "OEM-агностично",
    text: "Понимает разные бренды и версии продукта без перенастройки.",
  },
  {
    icon: EyeOff,
    title: "Защита данных",
    text: "Маскирует IP, хосты и секреты перед отправкой в ИИ.",
  },
];

export default function HomePage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Анализ саппорт-бандла</h1>
        <p className="text-[var(--muted)]">
          Загрузите архив диагностики — система найдёт корневые причины ошибок и
          предложит решения.
        </p>
      </div>

      <Card className="p-6">
        <UploadPanel />
      </Card>

      <RecentAnalyses />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <Card key={title} className="space-y-2">
            <Icon className="h-5 w-5 text-[var(--primary)]" />
            <div className="font-medium">{title}</div>
            <div className="text-sm text-[var(--muted)]">{text}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
