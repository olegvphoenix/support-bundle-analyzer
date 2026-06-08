"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Nav } from "@/components/nav";

const MIN_WIDTH = 180;
const MAX_WIDTH = 460;
const DEFAULT_WIDTH = 240;
const STORAGE_KEY = "sba:sidebarWidth";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragging = useRef(false);

  useEffect(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (saved >= MIN_WIDTH && saved <= MAX_WIDTH) setWidth(saved);
  }, []);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!dragging.current) return;
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
    setWidth(next);
  }, []);

  const stopDrag = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    setWidth((w) => {
      localStorage.setItem(STORAGE_KEY, String(w));
      return w;
    });
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDrag);
    };
  }, [onPointerMove, stopDrag]);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  return (
    <div className="min-h-screen">
      <Nav width={width} />

      {/* Resizable splitter between the sidebar and the main content. */}
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={startDrag}
        onDoubleClick={() => {
          setWidth(DEFAULT_WIDTH);
          localStorage.setItem(STORAGE_KEY, String(DEFAULT_WIDTH));
        }}
        className="group fixed inset-y-0 z-50 flex w-2 -translate-x-1/2 cursor-col-resize items-center justify-center"
        style={{ left: width }}
        title="Перетащите, чтобы изменить ширину меню (двойной клик — сброс)"
      >
        <span className="h-full w-px bg-[var(--border)] transition-colors group-hover:bg-[var(--primary)]" />
      </div>

      <main className="px-8 py-8" style={{ marginLeft: width }}>
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
