# Дизайн-макеты (для сверки с реализацией)

Утверждённые макеты UI (тёмная тема). Сопоставление с реализованными страницами:

| Макет | Страница / компонент реализации |
| --- | --- |
| `upload-processing.png` | `/` — `components/upload-panel.tsx` + состояние обработки `components/analysis/processing-view.tsx` |
| `upload-error.png` | состояние ошибки на `/analysis/[id]` и в `upload-panel.tsx` |
| `dashboard-triage.png` | `/analysis/[id]` — `components/analysis/report-view.tsx` (триаж: health-gauge, карточки проблем, шум) |
| `dashboard-healthy.png` | `/analysis/[id]` — тот же дашборд при высоком health score |
| `problem-detail-sheet.png` | боковая панель деталей проблемы (Sheet) в `report-view.tsx` |
| `timeline.png` | таймлайн событий (ещё не реализован — требует time-bucket данных в пайплайне) |
| `history.png` | `/history` — `app/history/page.tsx` |
| `settings.png` | `/settings` — `app/settings/page.tsx` (интеграции + OEM-реестр) |

> Примечание: `timeline.png` — единственный экран, который пока не реализован.
