# Question-day checklist

Pre-flight and on-call checks for the daily question's open → lock → reveal cycle (§6.2).

- Confirm tomorrow's daily question is `scheduled` (curate via `/admin/curate` at least a day ahead).
- Watch the ops dashboard's job health panel around `question:open` / `question:lock` / `reveal:fire` firing times.
- If `reveal:fire` misses its window, see the overdue-reveal banner on `/admin/ops` and the settlement-dispute runbook.
