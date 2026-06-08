"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { apiPath } from "@/lib/utils";

interface Oem {
  id: string;
  product: string;
  brandKey: string | null;
  headLog: string | null;
  versionPrefix: string | null;
  family: string | null;
  active: number;
}

interface Settings {
  llmProvider: string;
  llmModel: string;
  llmApiKeySet: boolean;
  tokenBudget: number;
  ragEnabled: boolean;
  ragUrl: string | null;
  ragApiKeySet: boolean;
  maskPii: boolean;
  s3Endpoint: string;
  s3Bucket: string;
  maxUploadGb: number;
  retentionDays: number;
}

const PROVIDERS: { value: string; label: string; models: string[] }[] = [
  {
    value: "google",
    label: "Google Gemini",
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  },
  {
    value: "openai",
    label: "OpenAI",
    models: ["gpt-5.5", "gpt-4o", "gpt-4o-mini"],
  },
  {
    value: "anthropic",
    label: "Anthropic",
    models: ["claude-3.7-sonnet", "claude-3.5-sonnet", "claude-3.5-haiku"],
  },
];

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data: settings } = useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: async () => (await fetch(apiPath("/api/settings"))).json(),
  });

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Настройки</h1>

      {settings ? (
        <SettingsForm
          settings={settings}
          onSaved={() => qc.invalidateQueries({ queryKey: ["settings"] })}
        />
      ) : (
        <Card className="flex items-center gap-2 text-[var(--muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
        </Card>
      )}

      <OemRegistry />
    </div>
  );
}

function SettingsForm({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: () => void;
}) {
  const initial = () => ({
    llmProvider: settings.llmProvider || "google",
    llmModel: settings.llmModel,
    llmApiKey: "",
    tokenBudget: settings.tokenBudget,
    ragEnabled: settings.ragEnabled,
    ragUrl: settings.ragUrl ?? "",
    ragApiKey: "",
    maskPii: settings.maskPii,
    s3Endpoint: settings.s3Endpoint,
    s3Bucket: settings.s3Bucket,
    maxUploadGb: settings.maxUploadGb,
    retentionDays: settings.retentionDays,
  });
  const [form, setForm] = useState(initial);
  const [showRagToken, setShowRagToken] = useState(false);

  useEffect(() => {
    setForm(initial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(apiPath("/api/settings"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    onSuccess: onSaved,
  });

  const provider =
    PROVIDERS.find((p) => p.value === form.llmProvider) ?? PROVIDERS[0];
  const modelOptions = provider.models.includes(form.llmModel)
    ? provider.models
    : [form.llmModel, ...provider.models];

  return (
    <>
      <SectionCard title="LLM">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Провайдер">
            <select
              className="input"
              value={form.llmProvider}
              onChange={(e) => {
                const next = PROVIDERS.find((p) => p.value === e.target.value)!;
                setForm({
                  ...form,
                  llmProvider: next.value,
                  llmModel: next.models[0],
                });
              }}
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Модель">
            <select
              className="input"
              value={form.llmModel}
              onChange={(e) => setForm({ ...form, llmModel: e.target.value })}
            >
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Бюджет токенов на бандл">
            <input
              className="input"
              type="number"
              min={1000}
              step={1000}
              value={form.tokenBudget}
              onChange={(e) =>
                setForm({ ...form, tokenBudget: Number(e.target.value) })
              }
            />
          </Field>
        </div>
        <Field label="API-ключ">
          <input
            className="input"
            type="password"
            value={form.llmApiKey}
            onChange={(e) => setForm({ ...form, llmApiKey: e.target.value })}
            placeholder={
              settings.llmApiKeySet ? "•••••• (задан, оставьте пустым)" : "не задан"
            }
          />
        </Field>
      </SectionCard>

      <SectionCard title="RAG (Lexiro)">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Базовый URL">
            <input
              className="input"
              value={form.ragUrl}
              onChange={(e) => setForm({ ...form, ragUrl: e.target.value })}
              placeholder="https://lexiro.io/mcp/"
            />
          </Field>
          <Field label="Токен">
            <div className="relative">
              <input
                className="input pr-10"
                type={showRagToken ? "text" : "password"}
                value={form.ragApiKey}
                onChange={(e) => setForm({ ...form, ragApiKey: e.target.value })}
                placeholder={
                  settings.ragApiKeySet
                    ? "•••••• (задан, оставьте пустым)"
                    : "не задан"
                }
              />
              <button
                type="button"
                onClick={() => setShowRagToken((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--foreground)]"
                aria-label={showRagToken ? "Скрыть" : "Показать"}
              >
                {showRagToken ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </Field>
        </div>
        <Toggle
          label="Включить ретривал"
          checked={form.ragEnabled}
          onChange={(v) => setForm({ ...form, ragEnabled: v })}
        />
      </SectionCard>

      <SectionCard title="Конфиденциальность">
        <Toggle
          label="Маскировать клиентские данные (IP, хосты, пользователи)"
          checked={form.maskPii}
          onChange={(v) => setForm({ ...form, maskPii: v })}
        />
        <p className="text-sm text-[var(--muted)]">
          Клиентские данные будут скрыты в анализах и не попадут в LLM и внешние
          сервисы.
        </p>
      </SectionCard>

      <SectionCard title="Хранилище">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="MinIO endpoint">
            <input
              className="input"
              value={form.s3Endpoint}
              onChange={(e) => setForm({ ...form, s3Endpoint: e.target.value })}
              placeholder="http://minio:9000"
            />
          </Field>
          <Field label="Bucket">
            <input
              className="input"
              value={form.s3Bucket}
              onChange={(e) => setForm({ ...form, s3Bucket: e.target.value })}
              placeholder="support-bundles"
            />
          </Field>
          <Field label="Макс. размер загрузки, ГБ">
            <input
              className="input"
              type="number"
              min={1}
              value={form.maxUploadGb}
              onChange={(e) =>
                setForm({ ...form, maxUploadGb: Number(e.target.value) })
              }
            />
          </Field>
          <Field label="Хранить архивы, дней">
            <input
              className="input"
              type="number"
              min={1}
              value={form.retentionDays}
              onChange={(e) =>
                setForm({ ...form, retentionDays: Number(e.target.value) })
              }
            />
          </Field>
        </div>
      </SectionCard>

      <div className="flex items-center justify-end gap-3">
        {save.isSuccess && (
          <span className="text-sm text-[var(--sev-ok)]">Сохранено</span>
        )}
        {save.isError && (
          <span className="text-sm text-[var(--sev-critical)]">
            Ошибка сохранения
          </span>
        )}
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Сохранить
        </Button>
      </div>
    </>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="space-y-4 p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

function OemRegistry() {
  const qc = useQueryClient();
  const { data: oems } = useQuery<Oem[]>({
    queryKey: ["oem"],
    queryFn: async () => (await fetch(apiPath("/api/oem"))).json(),
  });

  const [form, setForm] = useState({ product: "", headLog: "", versionPrefix: "", family: "" });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch(apiPath("/api/oem"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: form.product,
          headLog: form.headLog || null,
          versionPrefix: form.versionPrefix || null,
          family: form.family || null,
        }),
      });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    onSuccess: () => {
      setForm({ product: "", headLog: "", versionPrefix: "", family: "" });
      qc.invalidateQueries({ queryKey: ["oem"] });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await fetch(apiPath(`/api/oem/${id}`), { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["oem"] }),
  });

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        OEM-реестр (динамический)
      </h2>
      <p className="text-xs text-[var(--muted)]">
        Новые OEM-бренды распознаются автоматически по имени head-лога. Здесь можно
        задать дружелюбные названия и группировку. Версии определяются по мажору
        автоматически.
      </p>

      <Card className="grid gap-3 sm:grid-cols-5">
        <input
          className="input"
          placeholder="Название бренда*"
          value={form.product}
          onChange={(e) => setForm({ ...form, product: e.target.value })}
        />
        <input
          className="input"
          placeholder="head-лог (MyVms.log)"
          value={form.headLog}
          onChange={(e) => setForm({ ...form, headLog: e.target.value })}
        />
        <input
          className="input"
          placeholder="префикс версии (5.)"
          value={form.versionPrefix}
          onChange={(e) => setForm({ ...form, versionPrefix: e.target.value })}
        />
        <select
          className="input"
          value={form.family}
          onChange={(e) => setForm({ ...form, family: e.target.value })}
        >
          <option value="">family (авто)</option>
          <option value="axxon3">axxon3</option>
          <option value="axxon5">axxon5</option>
        </select>
        <Button onClick={() => create.mutate()} disabled={!form.product || create.isPending}>
          <Plus className="h-4 w-4" /> Добавить
        </Button>
      </Card>

      <div className="space-y-2">
        {oems?.map((o) => (
          <Card key={o.id} className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <span className="font-medium">{o.product}</span>
              {o.headLog && <Badge>{o.headLog}</Badge>}
              {o.versionPrefix && <Badge>v{o.versionPrefix}*</Badge>}
              {o.family && <Badge>{o.family}</Badge>}
            </div>
            <Button variant="ghost" size="sm" onClick={() => remove.mutate(o.id)} aria-label="Удалить">
              <Trash2 className="h-4 w-4 text-[var(--sev-critical)]" />
            </Button>
          </Card>
        ))}
        {oems && oems.length === 0 && (
          <Card className="text-sm text-[var(--muted)]">
            Записей нет — работает авто-детект по head-логам.
          </Card>
        )}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="block text-xs text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 text-left text-sm"
    >
      <span
        className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
        style={{ background: checked ? "var(--primary)" : "var(--surface-2)" }}
      >
        <span
          className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
          style={{ transform: checked ? "translateX(18px)" : "translateX(2px)" }}
        />
      </span>
      <span>{label}</span>
    </button>
  );
}
