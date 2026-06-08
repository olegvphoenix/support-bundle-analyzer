"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Uppy from "@uppy/core";
import Tus from "@uppy/tus";
import { UploadCloud, X } from "lucide-react";
import { apiPath, formatBytes } from "@/lib/utils";

const ALLOWED = [".7z", ".zip", ".tar", ".gz", ".tgz"];

interface Progress {
  name: string;
  uploaded: number;
  total: number;
  percent: number;
}

export function UploadPanel() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [tusUrl, setTusUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const uppyRef = useRef<Uppy | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(apiPath("/api/config"))
      .then((r) => r.json())
      .then((c) => setTusUrl(c.tusUrl || "http://localhost:1080/files"))
      .catch(() => setTusUrl("http://localhost:1080/files"));
  }, []);

  useEffect(() => {
    if (!tusUrl) return;

    const uppy = new Uppy({
      autoProceed: true,
      restrictions: { maxNumberOfFiles: 1, allowedFileTypes: ALLOWED },
    }).use(Tus, {
      endpoint: tusUrl,
      chunkSize: 64 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      removeFingerprintOnSuccess: true,
    });

    uppy.on("upload-progress", (file, p) => {
      if (!file || !p?.bytesTotal) return;
      setProgress({
        name: file.name ?? "архив",
        uploaded: p.bytesUploaded ?? 0,
        total: p.bytesTotal,
        percent: Math.round(((p.bytesUploaded ?? 0) / p.bytesTotal) * 100),
      });
    });

    uppy.on("restriction-failed", (_f, err: Error) => setError(err.message));
    uppy.on("error", (err: Error) => setError(err.message));

    uppy.on("complete", async (result) => {
      const url = result.successful?.[0]?.uploadURL;
      if (!url) return;
      const storageKey = url.split("/").pop();
      if (!storageKey) return;
      for (let i = 0; i < 12; i++) {
        const res = await fetch(
          apiPath(`/api/analyses?storageKey=${encodeURIComponent(storageKey)}`),
        );
        const row = await res.json();
        if (row?.id) {
          router.push(`/analysis/${row.id}`);
          return;
        }
        await new Promise((r) => setTimeout(r, 600));
      }
      setError("Загрузка завершена, но анализ не найден. Проверьте сервер очереди.");
    });

    uppyRef.current = uppy;
    return () => {
      uppy.destroy();
      uppyRef.current = null;
    };
  }, [router, tusUrl]);

  const addFile = (file: File) => {
    setError(null);
    try {
      uppyRef.current?.addFile({ name: file.name, type: file.type, data: file });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) addFile(file);
  };

  const cancel = () => {
    uppyRef.current?.cancelAll();
    setProgress(null);
  };

  return (
    <div className="space-y-4">
      {!progress && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors"
          style={{
            borderColor: dragOver ? "var(--primary)" : "var(--border)",
            background: dragOver ? "rgba(96,165,250,0.06)" : "var(--surface-2)",
          }}
        >
          <span className="grid h-14 w-14 place-items-center rounded-full bg-[var(--surface)] text-[var(--primary)]">
            <UploadCloud className="h-7 w-7" />
          </span>
          <div className="text-base font-medium">
            Перетащите .7z архив сюда или{" "}
            <button
              type="button"
              className="text-[var(--primary)] hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
            >
              выберите файл
            </button>
          </div>
          <div className="text-sm text-[var(--muted)]">
            до нескольких ГБ, докачка при разрыве
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED.join(",")}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) addFile(file);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {progress && (
        <div className="flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-[var(--surface)] text-xs font-bold text-[var(--primary)]">
            7z
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-sm font-medium">{progress.name}</span>
              <span className="shrink-0 text-sm font-semibold">{progress.percent}%</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--surface)]">
              <div
                className="h-full rounded-full bg-[var(--primary)] transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-[var(--muted)]">
                {formatBytes(progress.uploaded)} / {formatBytes(progress.total)}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-[rgba(34,197,94,0.12)] px-2 py-1 text-xs font-medium text-[var(--sev-ok)]">
                <UploadCloud className="h-3.5 w-3.5" /> Резюмируемая загрузка
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={cancel}
            className="shrink-0 rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
            aria-label="Отменить"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--sev-critical)]/40 bg-[rgba(239,68,68,0.1)] px-4 py-3 text-sm text-[var(--sev-critical)]">
          {error}
        </div>
      )}
    </div>
  );
}
