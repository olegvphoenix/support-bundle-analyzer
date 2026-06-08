"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, Plus, Trash2, XCircle } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";

interface Oem {
  id: string;
  product: string;
  brandKey: string | null;
  headLog: string | null;
  versionPrefix: string | null;
  family: string | null;
  active: number;
}

interface Config {
  gemini: boolean;
  geminiModel: string;
  lexiro: boolean;
  s3Endpoint: string;
  tusUrl: string;
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data: config } = useQuery<Config>({
    queryKey: ["config"],
    queryFn: async () => (await fetch("/api/config")).json(),
  });
  const { data: oems } = useQuery<Oem[]>({
    queryKey: ["oem"],
    queryFn: async () => (await fetch("/api/oem")).json(),
  });

  const [form, setForm] = useState({
    product: "",
    headLog: "",
    versionPrefix: "",
    family: "",
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/oem", {
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
      await fetch(`/api/oem/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["oem"] }),
  });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Настройки</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Интеграции
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <ConfigCard
            ok={config?.gemini}
            title="Gemini (LLM)"
            value={config?.gemini ? config.geminiModel : "не настроен (GOOGLE_GENERATIVE_AI_API_KEY)"}
          />
          <ConfigCard
            ok={config?.lexiro}
            title="Lexiro (RAG)"
            value={config?.lexiro ? "подключён" : "не настроен (LEXIRO_API_URL)"}
          />
          <ConfigCard ok title="MinIO (S3)" value={config?.s3Endpoint ?? "—"} />
          <ConfigCard ok title="tus upload" value={config?.tusUrl ?? "—"} />
        </div>
        <p className="text-xs text-[var(--muted)]">
          Ключи и адреса задаются через переменные окружения (.env). Здесь
          отображается только статус подключения.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          OEM-реестр (динамический)
        </h2>
        <p className="text-xs text-[var(--muted)]">
          Новые OEM-бренды распознаются автоматически по имени head-лога. Здесь
          можно задать дружелюбные названия и группировку. Версии определяются по
          мажору автоматически.
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
          <Button
            onClick={() => create.mutate()}
            disabled={!form.product || create.isPending}
          >
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove.mutate(o.id)}
                aria-label="Удалить"
              >
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
    </div>
  );
}

function ConfigCard({
  ok,
  title,
  value,
}: {
  ok?: boolean;
  title: string;
  value: string;
}) {
  return (
    <Card className="flex items-center justify-between py-4">
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-xs text-[var(--muted)]">{value}</div>
      </div>
      {ok ? (
        <CheckCircle2 className="h-5 w-5 text-[var(--sev-ok)]" />
      ) : (
        <XCircle className="h-5 w-5 text-[var(--sev-noise)]" />
      )}
    </Card>
  );
}
