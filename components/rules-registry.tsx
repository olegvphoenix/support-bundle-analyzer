"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, Pencil, Plus, Power, Trash2, X } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { apiPath } from "@/lib/utils";

export interface RuleRow {
  id: string;
  key: string;
  severity: string;
  subsystem: string;
  title: string;
  matchComponent: string | null;
  matchAnyOf: string[];
  matchAllOf: string[];
  freqMinPerMinute: number | null;
  cause: string | null;
  solution: string[];
  appliesTo: string[];
  retrievalQuery: string | null;
  enabled: number;
  source: string;
}

export interface RuleForm {
  title: string;
  severity: string;
  subsystem: string;
  matchComponent: string;
  matchAnyOf: string;
  matchAllOf: string;
  freqMinPerMinute: string;
  cause: string;
  solution: string;
  appliesTo: string[];
  retrievalQuery: string;
}

export const SEVERITY_OPTIONS: { value: string; label: string }[] = [
  { value: "critical", label: "Критично" },
  { value: "warning", label: "Предупреждение" },
  { value: "info", label: "Инфо" },
  { value: "noise", label: "Шум" },
];

export const SUBSYSTEM_OPTIONS: { value: string; label: string }[] = [
  { value: "license", label: "Лицензия" },
  { value: "cameras", label: "Камеры" },
  { value: "archive", label: "Архив" },
  { value: "detectors", label: "Детекторы" },
  { value: "network", label: "Сеть" },
  { value: "hardware", label: "Оборудование" },
  { value: "other", label: "Прочее" },
];

const FAMILY_OPTIONS = ["axxon3", "axxon5"];

export function emptyRuleForm(): RuleForm {
  return {
    title: "",
    severity: "warning",
    subsystem: "other",
    matchComponent: "",
    matchAnyOf: "",
    matchAllOf: "",
    freqMinPerMinute: "",
    cause: "",
    solution: "",
    appliesTo: [],
    retrievalQuery: "",
  };
}

function rowToForm(r: RuleRow): RuleForm {
  return {
    title: r.title,
    severity: r.severity,
    subsystem: r.subsystem,
    matchComponent: r.matchComponent ?? "",
    matchAnyOf: r.matchAnyOf.join("\n"),
    matchAllOf: r.matchAllOf.join("\n"),
    freqMinPerMinute: r.freqMinPerMinute ? String(r.freqMinPerMinute) : "",
    cause: r.cause ?? "",
    solution: r.solution.join("\n"),
    appliesTo: r.appliesTo,
    retrievalQuery: r.retrievalQuery ?? "",
  };
}

/** Reusable field set for a rule, shared by settings CRUD and report capture. */
export function RuleFormFields({
  form,
  setForm,
}: {
  form: RuleForm;
  setForm: (f: RuleForm) => void;
}) {
  const toggleFamily = (fam: string) => {
    const has = form.appliesTo.includes(fam);
    setForm({
      ...form,
      appliesTo: has
        ? form.appliesTo.filter((f) => f !== fam)
        : [...form.appliesTo, fam],
    });
  };

  return (
    <div className="space-y-3">
      <Field label="Заголовок*">
        <input
          className="input"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Например: Не найден ключ лицензии"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Важность">
          <select
            className="input"
            value={form.severity}
            onChange={(e) => setForm({ ...form, severity: e.target.value })}
          >
            {SEVERITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Подсистема">
          <select
            className="input"
            value={form.subsystem}
            onChange={(e) => setForm({ ...form, subsystem: e.target.value })}
          >
            {SUBSYSTEM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Компонент (необязательно)">
        <input
          className="input"
          value={form.matchComponent}
          onChange={(e) => setForm({ ...form, matchComponent: e.target.value })}
          placeholder="подстрока в имени компонента"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Совпадает любое (по строке)">
          <textarea
            className="input min-h-[72px] font-mono text-xs"
            value={form.matchAnyOf}
            onChange={(e) => setForm({ ...form, matchAnyOf: e.target.value })}
            placeholder={"одна фраза на строку\nlicense not found\nключ не найден"}
          />
        </Field>
        <Field label="Совпадают все (по строке)">
          <textarea
            className="input min-h-[72px] font-mono text-xs"
            value={form.matchAllOf}
            onChange={(e) => setForm({ ...form, matchAllOf: e.target.value })}
            placeholder={"все фразы должны встретиться"}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Порог шторма (событий/мин)">
          <input
            className="input"
            type="number"
            min={0}
            value={form.freqMinPerMinute}
            onChange={(e) =>
              setForm({ ...form, freqMinPerMinute: e.target.value })
            }
            placeholder="напр. 30"
          />
        </Field>
        <Field label="Запрос в базу знаний">
          <input
            className="input"
            value={form.retrievalQuery}
            onChange={(e) => setForm({ ...form, retrievalQuery: e.target.value })}
            placeholder="по умолчанию = заголовок"
          />
        </Field>
      </div>

      <Field label="Семейства продуктов (пусто = все)">
        <div className="flex gap-4 pt-1">
          {FAMILY_OPTIONS.map((fam) => (
            <label key={fam} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.appliesTo.includes(fam)}
                onChange={() => toggleFamily(fam)}
              />
              {fam}
            </label>
          ))}
        </div>
      </Field>

      <Field label="Причина">
        <textarea
          className="input min-h-[60px]"
          value={form.cause}
          onChange={(e) => setForm({ ...form, cause: e.target.value })}
          placeholder="Краткое описание корневой причины"
        />
      </Field>

      <Field label="Решение (по шагу на строку)">
        <textarea
          className="input min-h-[80px]"
          value={form.solution}
          onChange={(e) => setForm({ ...form, solution: e.target.value })}
          placeholder={"1 шаг на строку\nПроверьте подключение ключа\nПерезапустите службу"}
        />
      </Field>
    </div>
  );
}

export function formToPayload(form: RuleForm, source?: "manual" | "captured") {
  return {
    title: form.title,
    severity: form.severity,
    subsystem: form.subsystem,
    matchComponent: form.matchComponent || null,
    matchAnyOf: form.matchAnyOf,
    matchAllOf: form.matchAllOf,
    freqMinPerMinute: form.freqMinPerMinute,
    cause: form.cause,
    solution: form.solution,
    appliesTo: form.appliesTo,
    retrievalQuery: form.retrievalQuery,
    ...(source ? { source } : {}),
  };
}

export function RulesRegistry() {
  const qc = useQueryClient();
  const { data: rules } = useQuery<RuleRow[]>({
    queryKey: ["rules"],
    queryFn: async () => (await fetch(apiPath("/api/rules"))).json(),
  });

  const [form, setForm] = useState<RuleForm>(emptyRuleForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["rules"] });

  const save = useMutation({
    mutationFn: async () => {
      const url = editing ? `/api/rules/${editing}` : "/api/rules";
      const res = await fetch(apiPath(url), {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToPayload(form)),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "failed");
      return res.json();
    },
    onSuccess: () => {
      setForm(emptyRuleForm());
      setEditing(null);
      setOpen(false);
      invalidate();
    },
  });

  const toggle = useMutation({
    mutationFn: async (r: RuleRow) => {
      await fetch(apiPath(`/api/rules/${r.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: r.enabled ? false : true }),
      });
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await fetch(apiPath(`/api/rules/${id}`), { method: "DELETE" });
    },
    onSuccess: invalidate,
  });

  const startEdit = (r: RuleRow) => {
    setEditing(r.id);
    setForm(rowToForm(r));
    setOpen(true);
  };

  const startCreate = () => {
    setEditing(null);
    setForm(emptyRuleForm());
    setOpen(true);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Правила (обучаемая база знаний)
          </h2>
          <p className="text-xs text-[var(--muted)]">
            Эти правила дополняют встроенную базу и имеют приоритет. Их можно
            создавать вручную здесь или прямо из найденной проблемы в отчёте.
          </p>
        </div>
        <Button size="sm" onClick={startCreate}>
          <Plus className="h-4 w-4" /> Новое правило
        </Button>
      </div>

      <div className="space-y-2">
        {rules?.map((r) => (
          <Card key={r.id} className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: r.enabled ? "var(--sev-ok)" : "var(--muted)" }}
              />
              <div>
                <div className="font-medium">{r.title}</div>
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <Badge>{r.severity}</Badge>
                  <Badge>{r.subsystem}</Badge>
                  {r.source === "captured" && <Badge>из отчёта</Badge>}
                  {!r.enabled && <Badge>выключено</Badge>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggle.mutate(r)}
                aria-label="Вкл/выкл"
                title={r.enabled ? "Выключить" : "Включить"}
              >
                <Power className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => startEdit(r)} aria-label="Изменить">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove.mutate(r.id)}
                aria-label="Удалить"
              >
                <Trash2 className="h-4 w-4 text-[var(--sev-critical)]" />
              </Button>
            </div>
          </Card>
        ))}
        {rules && rules.length === 0 && (
          <Card className="text-sm text-[var(--muted)]">
            Пользовательских правил пока нет. Создайте первое или сохраните его из
            отчёта по кнопке «Сохранить как правило».
          </Card>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative h-full w-full max-w-xl overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                {editing ? "Изменить правило" : "Новое правило"}
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-4">
              <RuleFormFields form={form} setForm={setForm} />
            </div>
            <div className="mt-5 flex items-center justify-end gap-3">
              {save.isError && (
                <span className="text-sm text-[var(--sev-critical)]">
                  {(save.error as Error)?.message ?? "Ошибка"}
                </span>
              )}
              <Button variant="outline" onClick={() => setOpen(false)}>
                Отмена
              </Button>
              <Button onClick={() => save.mutate()} disabled={!form.title || save.isPending}>
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Сохранить
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="block text-xs text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}
