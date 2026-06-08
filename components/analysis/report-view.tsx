"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BookmarkPlus,
  Boxes,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  Database,
  Download,
  ExternalLink,
  FileText,
  GitBranch,
  HardDrive,
  KeyRound,
  ListTree,
  Loader2,
  Network,
  ScanEye,
  Video,
  X,
  Zap,
} from "lucide-react";
import type {
  AnalysisReport,
  CorrelationGroup,
  ReportProblem,
  Severity,
  Subsystem,
  TimelineEvent,
} from "@/lib/analyzer/types";
import {
  Badge,
  Button,
  Card,
  HealthGauge,
  SeverityBadge,
  SEVERITY_META,
} from "@/components/ui";
import {
  RuleFormFields,
  emptyRuleForm,
  formToPayload,
  type RuleForm,
} from "@/components/rules-registry";
import { apiPath, formatTs } from "@/lib/utils";

type Tab = "problems" | "timeline";

export function ReportView({ id, report }: { id: string; report: AnalysisReport }) {
  const [active, setActive] = useState<ReportProblem | null>(null);
  const [tab, setTab] = useState<Tab>("problems");

  return (
    <div className="space-y-6">
      <HeaderCard report={report} id={id} />
      <StatsRow report={report} />
      <SubsystemTiles report={report} />

      <InventoryBand report={report} />

      <CorrelationsBand
        report={report}
        onOpen={(pid) => {
          const p = report.problems.find((x) => x.id === pid);
          if (p) setActive(p);
        }}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="flex items-center gap-1 border-b border-[var(--border)]">
            <TabButton active={tab === "problems"} onClick={() => setTab("problems")}>
              Проблемы ({report.problems.length})
            </TabButton>
            <TabButton active={tab === "timeline"} onClick={() => setTab("timeline")}>
              <ListTree className="h-3.5 w-3.5" /> Таймлайн ({report.timeline.length})
            </TabButton>
          </div>

          {tab === "problems" ? (
            report.problems.length === 0 ? (
              <HealthyState />
            ) : (
              report.problems.map((p) => (
                <ProblemCard key={p.id} problem={p} onClick={() => setActive(p)} />
              ))
            )
          ) : (
            <TimelinePanel events={report.timeline} />
          )}
        </div>

        <div className="space-y-6">
          <FactsCard report={report} />
        </div>
      </div>

      <NoiseBand report={report} />

      {active && <ProblemSheet problem={active} onClose={() => setActive(null)} />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors"
      style={{
        borderColor: active ? "var(--primary)" : "transparent",
        color: active ? "var(--foreground)" : "var(--muted)",
      }}
    >
      {children}
    </button>
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
        <a href={apiPath(`/api/analyses/${id}/export?format=md`)} download>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4" /> Markdown
          </Button>
        </a>
        <a href={apiPath(`/api/analyses/${id}/export?format=json`)} download>
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

const SUBSYSTEMS: { key: Subsystem; label: string; icon: typeof KeyRound }[] = [
  { key: "license", label: "Лицензия", icon: KeyRound },
  { key: "cameras", label: "Камеры", icon: Video },
  { key: "archive", label: "Архив", icon: Database },
  { key: "detectors", label: "Детекторы", icon: ScanEye },
  { key: "network", label: "Сеть", icon: Network },
  { key: "hardware", label: "Оборудование", icon: Cpu },
];

const SEV_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2, noise: 3 };

function SubsystemTiles({ report }: { report: AnalysisReport }) {
  const map = useMemo(() => {
    const m = new Map<Subsystem, { worst: Severity | null; count: number }>();
    for (const p of report.problems) {
      const cur = m.get(p.subsystem) ?? { worst: null, count: 0 };
      cur.count += 1;
      if (cur.worst == null || SEV_RANK[p.severity] < SEV_RANK[cur.worst]) {
        cur.worst = p.severity;
      }
      m.set(p.subsystem, cur);
    }
    // Hard fact: missing license dongle escalates the license tile.
    if (!report.facts.licenseDongleFound) {
      const cur = m.get("license") ?? { worst: null, count: 0 };
      if (cur.worst == null || SEV_RANK["critical"] < SEV_RANK[cur.worst]) cur.worst = "critical";
      m.set("license", cur);
    }
    return m;
  }, [report]);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {SUBSYSTEMS.map(({ key, label, icon: Icon }) => {
        const info = map.get(key);
        const sev = info?.worst ?? null;
        const color = sev ? SEVERITY_META[sev].color : "var(--sev-ok)";
        const status = sev ? SEVERITY_META[sev].label : "В норме";
        return (
          <Card key={key} className="flex flex-col gap-2 py-4">
            <div className="flex items-center justify-between">
              <Icon className="h-5 w-5 text-[var(--muted)]" />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
            </div>
            <div className="text-sm font-medium">{label}</div>
            <div className="text-xs" style={{ color }}>
              {status}
              {info?.count ? ` · ${info.count}` : ""}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

const SUBSYSTEM_LABEL: Record<Subsystem, string> = {
  license: "Лицензия",
  cameras: "Камеры",
  archive: "Архив",
  detectors: "Детекторы",
  network: "Сеть",
  hardware: "Оборудование",
  other: "Прочее",
};

function InventoryBand({ report }: { report: AnalysisReport }) {
  const inv = report.inventory;
  const [open, setOpen] = useState(false);
  if (!inv || !inv.objects.length) return null;

  const tiles = [
    { type: "camera", label: "Камеры", icon: Video, count: inv.counts.camera },
    { type: "archive", label: "Архивы", icon: Database, count: inv.counts.archive },
    { type: "detector", label: "Детекторы", icon: ScanEye, count: inv.counts.detector },
    { type: "service", label: "Службы", icon: Cpu, count: inv.counts.service },
  ];
  const listed = inv.objects.filter((o) => o.type !== "service");
  const shown = open ? listed : listed.slice(0, 8);

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2">
        <Boxes className="h-4 w-4 text-[var(--muted)]" />
        <h3 className="text-sm font-semibold">Конфигурация объекта</h3>
        <span className="text-xs text-[var(--muted)]">из Config.local</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div
            key={t.type}
            className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3"
          >
            <t.icon className="h-5 w-5 text-[var(--muted)]" />
            <div>
              <div className="text-xl font-semibold">{t.count}</div>
              <div className="text-xs text-[var(--muted)]">{t.label}</div>
            </div>
          </div>
        ))}
      </div>

      {listed.length > 0 && (
        <div className="space-y-1.5">
          {shown.map((o) => (
            <div
              key={o.key}
              className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Badge>{o.type}</Badge>
                <span className="truncate font-medium">{o.name || o.key}</span>
              </span>
              <span className="shrink-0 text-xs text-[var(--muted)]">
                {[o.model, o.ip, o.volumes?.join(", ")].filter(Boolean).join(" · ") || o.key}
              </span>
            </div>
          ))}
          {listed.length > 8 && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="text-xs text-[var(--primary)]"
            >
              {open ? "свернуть" : `показать все (${listed.length})`}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

function CorrelationsBand({
  report,
  onOpen,
}: {
  report: AnalysisReport;
  onOpen: (problemId: string) => void;
}) {
  const groups: CorrelationGroup[] = report.correlations ?? [];
  if (!groups.length) return null;

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-[var(--muted)]" />
        <h3 className="text-sm font-semibold">Связанные события</h3>
        <span className="text-xs text-[var(--muted)]">
          цепочки вокруг одной сущности (камера, объект, адрес)
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((g) => {
          const color = SEVERITY_META[g.severity].color;
          return (
            <div
              key={g.entity}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] p-4"
              style={{ borderLeft: `3px solid ${color}` }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{g.label}</span>
                <SeverityBadge severity={g.severity} />
              </div>
              <ol className="relative mt-3 ml-1 border-l border-[var(--border)]">
                {g.steps.map((s, i) => (
                  <li key={`${s.problemId}-${i}`} className="relative py-1.5 pl-5">
                    <span
                      className="absolute -left-[5px] top-3 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--surface-2)]"
                      style={{ background: SEVERITY_META[s.severity].color }}
                    />
                    <button
                      onClick={() => onOpen(s.problemId)}
                      className="flex w-full flex-col items-start text-left hover:opacity-80"
                    >
                      <span className="flex items-center gap-2 text-xs text-[var(--muted)]">
                        {s.ts && (
                          <span className="font-mono">{formatTs(s.ts, true)}</span>
                        )}
                        <Badge>{SUBSYSTEM_LABEL[s.subsystem]}</Badge>
                      </span>
                      <span className="text-sm">{s.title}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function HealthyState() {
  return (
    <Card className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-[rgba(34,197,94,0.12)]">
        <CheckCircle2 className="h-9 w-9 text-[var(--sev-ok)]" />
      </div>
      <div className="text-lg font-semibold">Критичных проблем не обнаружено</div>
      <div className="max-w-sm text-sm text-[var(--muted)]">
        В логах преимущественно фоновый шум. Подавленные сообщения см. ниже.
      </div>
    </Card>
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
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}
      className="w-full cursor-pointer rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition-colors hover:bg-[var(--surface-2)]"
      style={{ borderLeft: `3px solid ${m.color}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={problem.severity} />
            {problem.storm && (
              <span className="inline-flex items-center gap-1 text-xs text-[var(--sev-warning)]">
                <Zap className="h-3 w-3" /> шторм
              </span>
            )}
            <Badge>{problem.subsystem}</Badge>
            <Badge>уверенность {Math.round(problem.confidence * 100)}%</Badge>
          </div>
          <div className="font-medium">{problem.title}</div>
          {problem.rootCause && (
            <div className="line-clamp-2 text-sm text-[var(--muted)]">
              {problem.rootCause}
            </div>
          )}
          <div className="flex items-center gap-3 pt-1 text-xs text-[var(--muted)]">
            {problem.component && (
              <span className="inline-flex items-center gap-1">
                <Activity className="h-3 w-3" /> {problem.component}
              </span>
            )}
            {problem.lastTs && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" /> {formatTs(problem.lastTs, true)}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold">
            {problem.count.toLocaleString("ru-RU")}
          </div>
          <div className="text-xs text-[var(--muted)]">повторов</div>
        </div>
      </div>
    </div>
  );
}

function TimelinePanel({ events }: { events: TimelineEvent[] }) {
  if (!events.length) {
    return (
      <Card className="text-sm text-[var(--muted)]">
        Недостаточно временных меток для построения таймлайна.
      </Card>
    );
  }
  return (
    <Card className="space-y-0 p-0">
      <ol className="relative ml-4 border-l border-[var(--border)]">
        {events.map((e, i) => {
          const color = SEVERITY_META[e.severity].color;
          return (
            <li key={i} className="relative py-3 pl-6 pr-4">
              <span
                className="absolute -left-[7px] top-4 h-3 w-3 rounded-full ring-4 ring-[var(--surface)]"
                style={{ background: color }}
              />
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-[var(--muted)]">
                    {formatTs(e.ts, true)}
                  </span>
                  <SeverityBadge severity={e.severity} />
                  {e.storm && <Zap className="h-3 w-3 text-[var(--sev-warning)]" />}
                </div>
                <span className="text-xs text-[var(--muted)]">×{e.count.toLocaleString("ru-RU")}</span>
              </div>
              <div className="pt-1 text-sm">{e.title}</div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

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

function NoiseBand({ report }: { report: AnalysisReport }) {
  const [open, setOpen] = useState(false);
  if (!report.noise.length) return null;
  const shown = open ? report.noise : report.noise.slice(0, 4);
  return (
    <Card className="space-y-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between"
      >
        <h3 className="text-sm font-semibold text-[var(--muted)]">
          Подавленный шум ({report.noise.length})
        </h3>
        <span className="text-xs text-[var(--primary)]">
          {open ? "свернуть" : "показать все"}
        </span>
      </button>
      <div className="grid gap-2 sm:grid-cols-2">
        {shown.map((n, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-sm"
          >
            <span className="line-clamp-1 text-[var(--muted)]">{n.title}</span>
            <span className="shrink-0 text-[var(--sev-noise)]">
              ×{n.count.toLocaleString("ru-RU")}
            </span>
          </div>
        ))}
      </div>
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
  const [copied, setCopied] = useState(false);
  const [showRule, setShowRule] = useState(false);
  const jiraSource = problem.sources.find((s) => s.kind === "jira" && s.url);

  const copySolution = async () => {
    const text = [problem.title, "", ...problem.solution.map((s, i) => `${i + 1}. ${s}`)].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative h-full w-full max-w-xl overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
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

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge>Повторов: {problem.count.toLocaleString("ru-RU")}</Badge>
          {problem.component && <Badge>Компонент: {problem.component}</Badge>}
          {problem.storm && (
            <Badge className="text-[var(--sev-warning)]">
              <Zap className="h-3 w-3" /> шторм
            </Badge>
          )}
          {problem.lastTs && <Badge>Последнее: {formatTs(problem.lastTs, true)}</Badge>}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {problem.solution.length > 0 && (
            <Button size="sm" variant="outline" onClick={copySolution}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Скопировано" : "Скопировать решение"}
            </Button>
          )}
          {jiraSource && (
            <a href={jiraSource.url ?? "#"} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline">
                <ExternalLink className="h-4 w-4" /> Открыть в Jira
              </Button>
            </a>
          )}
          <Button size="sm" variant="outline" onClick={() => setShowRule(true)}>
            <BookmarkPlus className="h-4 w-4" /> Сохранить как правило
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

      {showRule && (
        <SaveAsRuleModal problem={problem} onClose={() => setShowRule(false)} />
      )}
    </div>
  );
}

function problemToRuleForm(problem: ReportProblem): RuleForm {
  const base = emptyRuleForm();
  return {
    ...base,
    title: problem.title,
    severity: problem.severity,
    subsystem: problem.subsystem,
    matchComponent: problem.component ?? "",
    // Seed with the title as a starting phrase; the user refines it into a
    // stable substring that will reliably match future occurrences.
    matchAnyOf: problem.title,
    freqMinPerMinute: problem.storm ? "30" : "",
    cause: problem.rootCause ?? "",
    solution: problem.solution.join("\n"),
    retrievalQuery: problem.title,
  };
}

function SaveAsRuleModal({
  problem,
  onClose,
}: {
  problem: ReportProblem;
  onClose: () => void;
}) {
  const [form, setForm] = useState<RuleForm>(() => problemToRuleForm(problem));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(apiPath("/api/rules"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToPayload(form, "captured")),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Не удалось сохранить");
      }
      setSaved(true);
      setTimeout(onClose, 900);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative h-full w-full max-w-xl overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Сохранить как правило</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Уточните условие срабатывания (фразу из логов), чтобы правило надёжно
          ловило такие случаи в будущем.
        </p>
        <div className="mt-4">
          <RuleFormFields form={form} setForm={setForm} />
        </div>
        <div className="mt-5 flex items-center justify-end gap-3">
          {error && <span className="text-sm text-[var(--sev-critical)]">{error}</span>}
          {saved && <span className="text-sm text-[var(--sev-ok)]">Сохранено</span>}
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={save} disabled={!form.title || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Сохранить правило
          </Button>
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
