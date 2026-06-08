"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Download,
  FileText,
  HardDrive,
  KeyRound,
  Network,
  X,
  Zap,
  ExternalLink,
} from "lucide-react";
import type { AnalysisReport, ReportProblem } from "@/lib/analyzer/types";
import {
  Badge,
  Button,
  Card,
  HealthGauge,
  SeverityBadge,
  SEVERITY_META,
} from "@/components/ui";

export function ReportView({ id, report }: { id: string; report: AnalysisReport }) {
  const [active, setActive] = useState<ReportProblem | null>(null);

  return (
    <div className="space-y-6">
      <HeaderCard report={report} id={id} />
      <StatsRow report={report} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Проблемы ({report.problems.length})
          </h2>
          {report.problems.length === 0 && (
            <Card className="text-sm text-[var(--muted)]">
              Критичных проблем не обнаружено.
            </Card>
          )}
          {report.problems.map((p) => (
            <ProblemCard key={p.id} problem={p} onClick={() => setActive(p)} />
          ))}
        </div>

        <div className="space-y-6">
          <FactsCard report={report} />
          <NoisePanel report={report} />
        </div>
      </div>

      {active && <ProblemSheet problem={active} onClose={() => setActive(null)} />}
    </div>
  );
}

function HeaderCard({ report, id }: { report: AnalysisReport; id: string }) {
  return (
    <Card className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-6">
        <HealthGauge score={report.healthScore} />
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">{report.profile.productName}</span>
            <Badge>{report.profile.version ?? "версия ?"}</Badge>
            <Badge>{report.analyzedBy === "llm" ? "ИИ + правила" : "правила"}</Badge>
          </div>
          <div className="text-sm text-[var(--muted)]">
            Хост: {report.profile.host ?? "—"} · семейство {report.profile.productFamily}
          </div>
          <p className="max-w-xl pt-1 text-sm">{report.summary}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <a href={`/api/analyses/${id}/export?format=md`} download>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4" /> Markdown
          </Button>
        </a>
        <a href={`/api/analyses/${id}/export?format=json`} download>
          <Button variant="outline" size="sm">
            <FileText className="h-4 w-4" /> JSON
          </Button>
        </a>
      </div>
    </Card>
  );
}

function StatsRow({ report }: { report: AnalysisReport }) {
  const items = [
    { label: "Сигнатур", value: report.stats.totalSignatures },
    { label: "Ошибок", value: report.stats.errorCount },
    { label: "Предупреждений", value: report.stats.warnCount },
    { label: "Логов", value: report.stats.logFiles },
    { label: "Шум (строк)", value: report.stats.noiseLineCount },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
      {items.map((i) => (
        <Card key={i.label} className="py-4">
          <div className="text-2xl font-semibold">{i.value.toLocaleString("ru-RU")}</div>
          <div className="text-xs text-[var(--muted)]">{i.label}</div>
        </Card>
      ))}
    </div>
  );
}

function ProblemCard({
  problem,
  onClick,
}: {
  problem: ReportProblem;
  onClick: () => void;
}) {
  const m = SEVERITY_META[problem.severity];
  return (
    <button
      onClick={onClick}
      className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition-colors hover:bg-[var(--surface-2)]"
      style={{ borderLeft: `3px solid ${m.color}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <SeverityBadge severity={problem.severity} />
            {problem.storm && (
              <span className="inline-flex items-center gap-1 text-xs text-[var(--sev-warning)]">
                <Zap className="h-3 w-3" /> шторм
              </span>
            )}
            <Badge>{problem.subsystem}</Badge>
          </div>
          <div className="font-medium">{problem.title}</div>
          {problem.rootCause && (
            <div className="line-clamp-2 text-sm text-[var(--muted)]">
              {problem.rootCause}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold">
            {problem.count.toLocaleString("ru-RU")}
          </div>
          <div className="text-xs text-[var(--muted)]">повторов</div>
        </div>
      </div>
    </button>
  );
}

const SUBSYSTEM_ICON: Record<string, typeof KeyRound> = {
  license: KeyRound,
  network: Network,
  hardware: HardDrive,
  archive: HardDrive,
};

function FactsCard({ report }: { report: AnalysisReport }) {
  const f = report.facts;
  return (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold">Система</h3>
      <Row
        icon={KeyRound}
        label="Ключ лицензии"
        value={f.licenseDongleFound ? "найден" : "НЕ найден"}
        danger={!f.licenseDongleFound}
      />
      <Row icon={HardDrive} label="Дисков" value={String(f.disks.length)} />
      {f.disks.map((d) => {
        const pct = d.totalMb ? Math.round((d.freeMb / d.totalMb) * 100) : 0;
        return (
          <Row
            key={d.name}
            icon={HardDrive}
            label={`Диск ${d.name}`}
            value={`${pct}% свободно`}
            danger={pct < 5}
          />
        );
      })}
      <Row icon={Network} label="Открытых портов" value={String(f.openPortsCount ?? "?")} />
      {f.notes.map((n, i) => (
        <div key={i} className="flex items-start gap-2 text-sm text-[var(--sev-warning)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {n}
        </div>
      ))}
    </Card>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  danger,
}: {
  icon: typeof KeyRound;
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2 text-[var(--muted)]">
        <Icon className="h-4 w-4" /> {label}
      </span>
      <span style={danger ? { color: "var(--sev-critical)" } : undefined}>{value}</span>
    </div>
  );
}

function NoisePanel({ report }: { report: AnalysisReport }) {
  if (!report.noise.length) return null;
  return (
    <Card className="space-y-2">
      <h3 className="text-sm font-semibold text-[var(--muted)]">
        Подавленный шум ({report.noise.length})
      </h3>
      {report.noise.map((n, i) => (
        <div key={i} className="flex items-center justify-between text-sm">
          <span className="line-clamp-1 text-[var(--muted)]">{n.title}</span>
          <span className="shrink-0 text-[var(--sev-noise)]">
            ×{n.count.toLocaleString("ru-RU")}
          </span>
        </div>
      ))}
    </Card>
  );
}

function ProblemSheet({
  problem,
  onClose,
}: {
  problem: ReportProblem;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative h-full w-full max-w-xl overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <SeverityBadge severity={problem.severity} />
              <Badge>{problem.subsystem}</Badge>
              <Badge>уверенность {Math.round(problem.confidence * 100)}%</Badge>
            </div>
            <h2 className="text-lg font-semibold">{problem.title}</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-6 space-y-6">
          {problem.rootCause && (
            <Section title="Корневая причина">
              <p className="text-sm">{problem.rootCause}</p>
            </Section>
          )}
          {problem.impact && (
            <Section title="Влияние">
              <p className="text-sm">{problem.impact}</p>
            </Section>
          )}
          {problem.solution.length > 0 && (
            <Section title="Решение">
              <ol className="list-decimal space-y-1.5 pl-5 text-sm">
                {problem.solution.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </Section>
          )}
          {problem.sources.length > 0 && (
            <Section title="Источники (база знаний)">
              <div className="space-y-2">
                {problem.sources.map((s, i) => (
                  <a
                    key={i}
                    href={s.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--surface-2)]"
                  >
                    <span className="flex items-center gap-2">
                      <Badge>{s.kind}</Badge>
                      <span className="line-clamp-1">{s.title}</span>
                    </span>
                    {s.url && <ExternalLink className="h-3.5 w-3.5 text-[var(--muted)]" />}
                  </a>
                ))}
              </div>
            </Section>
          )}
          <Section title={`Примеры из логов (${problem.affectedFiles.length} файлов)`}>
            <div className="space-y-2">
              {problem.sampleMessages.map((m, i) => (
                <pre
                  key={i}
                  className="overflow-x-auto rounded-lg bg-[var(--background)] p-3 font-mono text-xs text-[var(--muted)]"
                >
                  {m}
                </pre>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {problem.affectedFiles.slice(0, 8).map((f) => (
                <Badge key={f}>{f}</Badge>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {title}
      </h3>
      {children}
    </div>
  );
}
