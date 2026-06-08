"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plus, Save, Trash2, XCircle } from "lucide-react";
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
  llmModel: string;
  llmApiKeySet: boolean;
  ragEnabled: boolean;
  ragUrl: string | null;
  ragApiKeySet: boolean;
  maskPii: boolean;
  maxUploadGb: number;
  retentionDays: number;
}

interface Config {
  s3Endpoint: string;
  tusUrl: string;
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data: settings } = useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: async () => (await fetch(apiPath("/api/settings"))).json(),
  });
  const { data: config } = useQuery<Config>({
    queryKey: ["config"],
    queryFn: async () => (await fetch(apiPath("/api/config"))).json(),
  });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Настройки</h1>

      {settings ? (
        <SettingsForm settings={settings} config={config} onSaved={() => qc.invalidateQueries({ queryKey: ["settings"] })} />
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
  config,
  onSaved,
}: {
  settings: Settings;
  config?: Config;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    llmModel: settings.llmModel,
    llmApiKey: "",
    ragEnabled: settings.ragEnabled,
    ragUrl: settings.ragUrl ?? "",
    ragApiKey: "",
    maskPii: settings.maskPii,
    maxUploadGb: settings.maxUploadGb,
    retentionDays: settings.retentionDays,
  });

  useEffect(() => {
    setForm({
      llmModel: settings.llmModel,
      llmApiKey: "",
      ragEnabled: settings.ragEnabled,
      ragUrl: settings.ragUrl ?? "",
      ragApiKey: "",
      maskPii: settings.maskPii,
      maxUploadGb: settings.maxUploadGb,
      retentionDays: settings.retentionDays,
    });
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

  const llmOk = settings.llmApiKeySet || form.llmApiKey.length > 0;
  const ragOk = settings.ragEnabled && (settings.ragApiKeySet || !!settings.ragUrl || !!form.ragUrl);

  return (
    <>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Статус интеграций
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatusCard ok={llmOk} title="Gemini (LLM)" value={settings.llmModel} />
          <StatusCard ok={ragOk} title="Lexiro (RAG)" value={settings.ragEnabled ? "включён" : "выключен"} />
          <StatusCard ok title="MinIO (S3)" value={config?.s3Endpoint ?? "—"} />
          <StatusCard ok title="tus upload" value={config?.tusUrl ?? "—"} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Анализ и ИИ
        </h2>
        <Card className="grid gap-4 sm:grid-cols-2">
          <Field label="Модель LLM (Gemini)">
            <input
              className="input"
              value={form.llmModel}
              onChange={(e) => setForm({ ...form, llmModel: e.target.value })}
              placeholder="gemini-1.5-pro"
            />
          </Field>
          <Field label="API-ключ Gemini">
            <input
              className="input"
              type="password"
              value={form.llmApiKey}
              onChange={(e) => setForm({ ...form, llmApiKey: e.target.value })}
              placeholder={settings.llmApiKeySet ? "•••••• (задан, оставьте пустым)" : "не задан"}
            />
          </Field>
          <Toggle
            label="Маскировать персональные данные (IP, хосты, секреты) перед отправкой в ИИ"
            checked={form.maskPii}
            onChange={(v) => setForm({ ...form, maskPii: v })}
          />
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          База знаний (RAG / Lexiro)
        </h2>
        <Card className="grid gap-4 sm:grid-cols-2">
          <Toggle
            label="Использовать базу знаний для подсказок решений"
            checked={form.ragEnabled}
            onChange={(v) => setForm({ ...form, ragEnabled: v })}
          />
          <div />
          <Field label="URL Lexiro API">
            <input
              className="input"
              value={form.ragUrl}
              onChange={(e) => setForm({ ...form, ragUrl: e.target.value })}
              placeholder="https://host/api"
            />
          </Field>
          <Field label="API-ключ Lexiro">
            <input
              className="input"
              type="password"
              value={form.ragApiKey}
              onChange={(e) => setForm({ ...form, ragApiKey: e.target.value })}
              placeholder={settings.ragApiKeySet ? "•••••• (задан, оставьте пустым)" : "не задан"}
            />
          </Field>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Загрузка и хранение
        </h2>
        <Card className="grid gap-4 sm:grid-cols-2">
          <Field label="Макс. размер архива, ГБ">
            <input
              className="input"
              type="number"
              min={1}
              value={form.maxUploadGb}
              onChange={(e) => setForm({ ...form, maxUploadGb: Number(e.target.value) })}
            />
          </Field>
          <Field label="Срок хранения, дней">
            <input
              className="input"
              type="number"
              min={1}
              value={form.retentionDays}
              onChange={(e) => setForm({ ...form, retentionDays: Number(e.target.value) })}
            />
          </Field>
        </Card>
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Сохранить настройки
        </Button>
        {save.isSuccess && <span className="text-sm text-[var(--sev-ok)]">Сохранено</span>}
        {save.isError && <span className="text-sm text-[var(--sev-critical)]">Ошибка сохранения</span>}
      </div>
    </>
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
      className="flex items-center gap-3 text-left text-sm sm:col-span-2"
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
      <span className="text-[var(--muted)]">{label}</span>
    </button>
  );
}

function StatusCard({ ok, title, value }: { ok?: boolean; title: string; value: string }) {
  return (
    <Card className="flex items-center justify-between py-4">
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        <div className="truncate text-xs text-[var(--muted)]">{value}</div>
      </div>
      {ok ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--sev-ok)]" />
      ) : (
        <XCircle className="h-5 w-5 shrink-0 text-[var(--sev-noise)]" />
      )}
    </Card>
  );
}
