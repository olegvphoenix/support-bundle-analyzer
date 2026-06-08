import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Support Bundle Analyzer",
  description:
    "Умный анализ саппорт-бандлов систем видеонаблюдения на платформе AxxonOne / Axxon Next",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <Providers>
          <div className="min-h-screen">
            <Nav />
            <main className="ml-60 px-8 py-8">
              <div className="mx-auto max-w-6xl">{children}</div>
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
