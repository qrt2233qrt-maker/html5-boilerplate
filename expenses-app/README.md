# Business Expenses app

A copy of the Business Expenses Claude artifact
(https://claude.ai/artifact/Y5aQuSSFAdFDbFrk3gjVEE): a bilingual (Arabic/English)
expense tracker with categories, receipt photos, budgets, reports with CSV
export, team approvals and an owner-only salaries section. Amounts are in IQD.

`index.html` is self-contained. It uses the Claude artifact runtime
(`window.claude.use("db" | "user" | "downloads")`) for storage, sign-in and file
downloads. If you open it outside Claude, it only shows "Open this app from its
Claude link". To run it on its own, replace those calls with your own backend.

## Data access rules (as published)

| Path               | Read     | Write    |
| ------------------ | -------- | -------- |
| (root)             | interact | admin    |
| `expenses`         | admin    | admin    |
| `expenses/{self}`  | interact | interact |
| `members`          | interact | admin    |
| `members/{self}`   | interact | interact |
| `payroll`          | owner    | owner    |
