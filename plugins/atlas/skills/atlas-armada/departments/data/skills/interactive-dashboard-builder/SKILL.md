---
name: interactive-dashboard-builder
description: Build self-contained interactive HTML dashboards with Chart.js, dropdown filters, and professional styling. Use when creating dashboards, building interactive reports, or generating shareable HTML files with charts and filters that work without a server.
when_to_use: creating a self-contained HTML dashboard with Chart.js; building interactive reports with dropdown and date filters; generating shareable dashboard HTML files that run without a server
allowed-tools: Read, Glob, Grep, Bash
---

# Interactive Dashboard Builder Skill

Patterns and techniques for building self-contained HTML/JS dashboards with
Chart.js, filters, interactivity, and professional styling. The dashboard is
a single HTML file: data embedded inline, charts rendered client-side, no
server required.

## First Move

1. Confirm the data shape (rows, columns, grain) and the 2-4 metrics the
   dashboard must surface.
2. Decide KPI cards, chart selection, and filter dimensions up front.
3. Emit the base template below, then implement filters, KPIs, charts, and
   table in that order.
4. For detailed component code (chart factories, filter logic, sortable
   tables, the full CSS system, and performance tuning for large datasets),
   read `references/interactive-dashboard-reference.md` - one level deep.

## Base Template

Every dashboard follows this structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard Title</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.1" integrity="sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ" crossorigin="anonymous"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0" integrity="sha384-cVMg8E3QFwTvGCDuK+ET4PD341jF3W8nO1auiXfuZNQkzbUUiBGLsIQUE+b1mxws" crossorigin="anonymous"></script>
    <style>
        /* Dashboard styles go here - see references/interactive-dashboard-reference.md */
    </style>
</head>
<body>
    <div class="dashboard-container">
        <header class="dashboard-header">
            <h1>Dashboard Title</h1>
            <div class="filters">
                <!-- Filter controls -->
            </div>
        </header>

        <section class="kpi-row">
            <!-- KPI cards -->
        </section>

        <section class="chart-row">
            <!-- Chart containers -->
        </section>

        <section class="table-section">
            <!-- Data table -->
        </section>

        <footer class="dashboard-footer">
            <span>Data as of: <span id="data-date"></span></span>
        </footer>
    </div>

    <script>
        // Embedded data
        const DATA = [];

        // Dashboard logic
        class Dashboard {
            constructor(data) {
                this.rawData = data;
                this.filteredData = data;
                this.charts = {};
                this.init();
            }

            init() {
                this.setupFilters();
                this.renderKPIs();
                this.renderCharts();
                this.renderTable();
            }

            applyFilters() {
                // Filter logic - see references/interactive-dashboard-reference.md
                this.filteredData = this.rawData.filter(row => {
                    // Apply each active filter
                    return true; // placeholder
                });
                this.renderKPIs();
                this.updateCharts();
                this.renderTable();
            }

            // ... methods for each section
        }

        const dashboard = new Dashboard(DATA);
    </script>
</body>
</html>
```

## KPI Card Pattern

HTML structure:

```html
<div class="kpi-card">
    <div class="kpi-label">Total Revenue</div>
    <div class="kpi-value" id="kpi-revenue">$0</div>
    <div class="kpi-change positive" id="kpi-revenue-change">+0%</div>
</div>
```

Render and format helper:

```javascript
function renderKPI(elementId, value, previousValue, format = 'number') {
    const el = document.getElementById(elementId);
    const changeEl = document.getElementById(elementId + '-change');

    // Format the value
    el.textContent = formatValue(value, format);

    // Calculate and display change
    if (previousValue && previousValue !== 0) {
        const pctChange = ((value - previousValue) / previousValue) * 100;
        const sign = pctChange >= 0 ? '+' : '';
        changeEl.textContent = `${sign}${pctChange.toFixed(1)}% vs prior period`;
        changeEl.className = `kpi-change ${pctChange >= 0 ? 'positive' : 'negative'}`;
    }
}

function formatValue(value, format) {
    switch (format) {
        case 'currency':
            if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
            if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
            return `$${value.toFixed(0)}`;
        case 'percent':
            return `${value.toFixed(1)}%`;
        case 'number':
            if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
            if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
            return value.toLocaleString();
        default:
            return value.toString();
    }
}
```

## Chart Container Pattern

```html
<div class="chart-container">
    <h3 class="chart-title">Monthly Revenue Trend</h3>
    <canvas id="revenue-chart"></canvas>
</div>
```

Chart factories (line, bar, doughnut) and the `updateChart` helper for
filter-triggered redraws live in `references/interactive-dashboard-reference.md`
under "Chart.js Integration".

## Filter Wiring

Each filter control calls `dashboard.applyFilters()` on change. The
`applyFilters` method re-runs every filter predicate against `rawData`,
then re-renders KPIs, updates charts, and re-renders the table. Keep the
filter pipeline pure: input is `rawData`, output is `filteredData`.

Filter types supported (dropdown, date range, combined logic, sortable
table): see `references/interactive-dashboard-reference.md` under "Filter
and Interactivity Implementation".

## Styling

The dashboard uses a CSS custom-property token system for background layers,
text, data accent colors, status colors, spacing, and radius. Full CSS
(color system, layout, KPI cards, chart containers, filters, data table,
responsive breakpoints, and print rules) is in
`references/interactive-dashboard-reference.md` under "CSS Styling for
Dashboards".

Key tokens to set before anything else:

```css
:root {
    --bg-primary: #f8f9fa;
    --bg-card: #ffffff;
    --bg-header: #1a1a2e;
    --text-primary: #212529;
    --text-secondary: #6c757d;
    --text-on-dark: #ffffff;
    --positive: #28a745;
    --negative: #dc3545;
    --gap: 16px;
    --radius: 8px;
}
```

The data accent palette mirrors the visualization skill for cross-skill
consistency: `#4C72B0`, `#DD8452`, `#55A868`, `#C44E52`, `#8172B3`, `#937860`.

## Performance for Large Datasets

| Data Size | Approach |
|---|---|
| <1,000 rows | Embed directly. Full interactivity. |
| 1,000 - 10,000 rows | Embed. May need to pre-aggregate for charts. |
| 10,000 - 100,000 rows | Pre-aggregate server-side. Embed aggregated data only. |
| >100,000 rows | Not suitable for client-side. Use a BI tool or paginate. |

Pre-aggregation pattern, chart point caps, DOM pagination, and the
`Chart.update('none')` rule are in
`references/interactive-dashboard-reference.md` under "Performance
Considerations for Large Datasets".

## Build Checklist

Before declaring a dashboard done:

- [ ] Single HTML file, opens offline (only CDN deps are Chart.js + date adapter).
- [ ] KPI cards show value and period-over-period change with correct sign.
- [ ] Every filter re-runs KPIs, charts, and table through `applyFilters`.
- [ ] Charts use `maintainAspectRatio: false` and live in fixed-height containers.
- [ ] Sortable table headers toggle asc/desc; default sort is sensible.
- [ ] Responsive breakpoints at 768px; print styles hide filters.
- [ ] Data embedded inline (no fetch calls, no server).
- [ ] For >1,000 rows, charts consume pre-aggregated data, not raw rows.