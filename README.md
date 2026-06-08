# Support Bundle Analyzer

Умный анализ саппорт-бандлов систем видеонаблюдения на платформе **AxxonOne / Axxon Next** (и их OEM-сборок). Загружаете архив диагностики — система находит корневые причины ошибок, отделяет их от фонового шума и предлагает решения, подкреплённые базой знаний (прошлые тикеты + документация).

## Возможности

- **Авто-триаж**: детерминированные правила (YAML) + анализ ИИ (Gemini) определяют критичные проблемы и подавляют шум.
- **OEM-агностичность**: продукт распознаётся по инвариантам (head-лог, версия). Новые OEM-бренды детектятся автоматически; реестр настраивается без передеплоя.
- **RAG (Lexiro)**: решения подкрепляются ссылками на исторические тикеты и документацию.
- **Большие бандлы**: возобновляемая загрузка (tus) в объектное хранилище (MinIO), потоковая распаковка и парсинг — постоянный расход памяти на гигабайтных архивах.
- **Защита данных**: IP, хосты, пути и секреты маскируются перед отправкой в LLM/RAG.

## Стек

Next.js 15 (App Router, React 19, TS) · Tailwind v4 · Drizzle ORM + PostgreSQL · BullMQ + Redis · MinIO (S3) · tus · Vercel AI SDK (Gemini) · node-7z.

## Архитектура

```
Браузер (Uppy) ──tus──► tus-сервер (Node) ──► MinIO (S3)
                                           └─ enqueue ─► Redis/BullMQ ─► Worker (Node)
                                                                          └─ lib/analyzer/pipeline
                                                                             (распаковка → парсинг →
                                                                              правила → RAG → Gemini)
                                                                          └─► PostgreSQL
Next.js (web): UI + API (история, отчёт, SSE-прогресс, экспорт, OEM CRUD)
```

## Локальный запуск

1. Инфраструктура (Postgres, Redis, MinIO):

```bash
docker compose up -d postgres redis minio
```

2. Настройка окружения:

```bash
cp .env.example .env
# заполните GOOGLE_GENERATIVE_AI_API_KEY (и при наличии LEXIRO_API_URL)
```

3. Зависимости и миграции:

```bash
npm install
npm run db:migrate
```

4. Запуск всех процессов (web + worker + tus):

```bash
npm run dev:all
```

Откройте http://localhost:3000.

## Запуск в Docker (всё целиком)

```bash
cp .env.example .env   # заполнить ключи
docker compose up -d --build
docker compose run --rm web npm run db:migrate
```

## CLI-анализ (без инфраструктуры)

Прогон пайплайна по уже распакованному бандлу:

```bash
npm run analyze:cli -- "D:\\путь\\к\\распакованному\\бандлу"
```

## Структура

```
app/            — UI (страницы) и API route handlers
components/      — React-компоненты (UI, дашборд)
lib/analyzer/   — ядро анализа (parser, reducer, rules-engine, profile, facts,
                  redact, evidence, llm, retrieval, pipeline, oem-map)
lib/analyzer/rules/ — база правил (YAML)
db/             — схема Drizzle, подключение, миграции
worker/         — BullMQ-воркер (оркестрация пайплайна)
server/         — tus-сервер загрузки
scripts/        — CLI-утилиты
```

## Правила анализа

База правил — `lib/analyzer/rules/*.yaml`. Каждое правило: сигнатура (компонент + текст RU/EN), severity (`critical|warning|info|noise`), причина, шаги решения и запрос к базе знаний. Правила можно дополнять без изменения кода.
