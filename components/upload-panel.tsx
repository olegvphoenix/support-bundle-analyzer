"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Uppy from "@uppy/core";
import Tus from "@uppy/tus";
import Dashboard from "@uppy/dashboard";
import "@uppy/core/dist/style.min.css";
import "@uppy/dashboard/dist/style.min.css";
import { apiPath } from "@/lib/utils";

export function UploadPanel() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [tusUrl, setTusUrl] = useState<string | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);

  // Resolve the tus endpoint at runtime so one image works on any host.
  useEffect(() => {
    fetch(apiPath("/api/config"))
      .then((r) => r.json())
      .then((c) => setTusUrl(c.tusUrl || "http://localhost:1080/files"))
      .catch(() => setTusUrl("http://localhost:1080/files"));
  }, []);

  useEffect(() => {
    if (!mountRef.current || !tusUrl) return;
    const TUS_URL = tusUrl;

    const uppy = new Uppy({
      autoProceed: true,
      restrictions: {
        maxNumberOfFiles: 1,
        allowedFileTypes: [".7z", ".zip", ".tar", ".gz", ".tgz"],
      },
    })
      .use(Tus, {
        endpoint: TUS_URL,
        chunkSize: 64 * 1024 * 1024,
        retryDelays: [0, 1000, 3000, 5000, 10000],
        removeFingerprintOnSuccess: true,
      })
      .use(Dashboard, {
        target: mountRef.current,
        inline: true,
        height: 320,
        proudlyDisplayPoweredByUppy: false,
        theme: "dark",
        note: "Поддерживаются архивы .7z / .zip до нескольких ГБ. Загрузка возобновляемая.",
      });

    const onComplete = async (result: {
      successful?: { uploadURL?: string }[];
    }) => {
      const url = result.successful?.[0]?.uploadURL;
      if (!url) return;
      const storageKey = url.split("/").pop();
      if (!storageKey) return;
      // The analysis row is created server-side at upload finish; resolve its id.
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
    };

    uppy.on("complete", onComplete);
    uppy.on("error", (e: Error) => setError(e.message));

    return () => {
      uppy.destroy();
    };
  }, [router, tusUrl]);

  return (
    <div className="space-y-3">
      <div ref={mountRef} />
      {error && (
        <div className="rounded-lg border border-[var(--sev-critical)]/40 bg-[rgba(239,68,68,0.1)] px-4 py-3 text-sm text-[var(--sev-critical)]">
          {error}
        </div>
      )}
    </div>
  );
}
