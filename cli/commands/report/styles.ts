/**
 * CSS styles for report pages
 * @module cli/commands/report/styles
 */

/**
 * CSS styles for the main index report page
 */
export const INDEX_PAGE_STYLES = `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    header { text-align: center; margin-bottom: 3rem; }
    header h1 { font-size: 2.5rem; margin: 0; color: #2563eb; }
    header p { font-size: 1.1rem; color: #6b7280; margin: 0.5rem 0; }
    .report-date { font-size: 0.875rem; color: #9ca3af; margin-top: 1rem; margin-bottom: 0.25rem; }
    .data-date { font-size: 0.875rem; color: #9ca3af; margin-top: 0; }
    .header-links { margin: 1rem 0; }
    .header-links a { color: #2563eb; text-decoration: none; margin: 0 0.75rem; font-weight: 500; }
    .header-links a:hover { text-decoration: underline; }
    .stat-label[title] { cursor: help; border-bottom: 1px dotted #9ca3af; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin: 1rem 0 2rem; }
    .metric-card { background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1.5rem; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .metric-card.success { border-color: #10b981; background: #f0fdf4; }
    .metric-card.error { border-color: #ef4444; background: #fef2f2; }
    .metric-value { font-size: 2rem; font-weight: bold; color: #1f2937; }
    .metric-label { font-size: 0.875rem; color: #6b7280; margin-top: 0.5rem; }
    h2 { color: #1f2937; margin: 2rem 0 1rem; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
    .models-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
    .model-card { background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .model-card h3 { margin: 0 0 1rem 0; color: #1f2937; font-size: 1rem; word-break: break-all; }
    .model-card h3 a { color: #2563eb; text-decoration: none; word-break: break-all; }
    .model-card h3 a:hover { text-decoration: underline; }
    .card-details-link { display: inline-block; margin-top: 0.75rem; color: #2563eb; text-decoration: none; font-size: 0.875rem; font-weight: 500; }
    .card-details-link:hover { text-decoration: underline; }
    .stat { display: flex; justify-content: space-between; margin-bottom: 0.5rem; }
    .stat-label { color: #6b7280; font-size: 0.875rem; }
    .stat-value { font-weight: 500; color: #1f2937; }
    .shortcomings-section { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; }
    .shortcomings-section h4 { margin: 0 0 0.5rem 0; font-size: 0.875rem; color: #4b5563; font-weight: 600; }
    .shortcomings-list { list-style: none; padding: 0; margin: 0; }
    .shortcoming-item { display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.8rem; cursor: help; }
    .shortcoming-concept { color: #dc2626; }
    .shortcoming-count { color: #6b7280; font-size: 0.75rem; }
    .shortcomings-more { font-size: 0.75rem; color: #9ca3af; margin-top: 0.25rem; }
    .view-all-link { color: #2563eb; text-decoration: none; font-weight: 500; margin-left: 0.5rem; }
    .view-all-link:hover { text-decoration: underline; }
    /* CSS Tooltips */
    .has-tooltip { position: relative; }
    .has-tooltip::after {
      content: attr(data-tooltip);
      position: absolute;
      left: 0;
      top: 100%;
      margin-top: 4px;
      background: #1f2937;
      color: #f3f4f6;
      padding: 0.75rem;
      border-radius: 0.5rem;
      white-space: pre-wrap;
      max-width: 350px;
      min-width: 200px;
      z-index: 1000;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity 0.2s, visibility 0.2s;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      font-size: 0.75rem;
      line-height: 1.4;
    }
    .has-tooltip:hover::after { opacity: 1; visibility: visible; }
    .matrix-legend { color: #6b7280; font-size: 0.875rem; margin-bottom: 1rem; }
    .matrix-legend .pass { color: #166534; font-weight: bold; }
    .matrix-legend .fail { color: #991b1b; font-weight: bold; }
    .matrix-container { overflow-x: auto; background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .result-matrix { border-collapse: collapse; width: 100%; font-size: 0.8rem; }
    .result-matrix th, .result-matrix td { padding: 0.5rem; text-align: center; border: 1px solid #e5e7eb; }
    .result-matrix th { background: #f9fafb; font-weight: 600; color: #374151; white-space: nowrap; }
    .result-matrix .task-id { text-align: left; font-family: monospace; font-weight: 500; white-space: nowrap; background: #f9fafb; position: sticky; left: 0; }
    .result-matrix .task-desc { text-align: left; max-width: 300px; font-size: 0.75rem; color: #4b5563; cursor: help; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .matrix-cell { width: 2rem; font-weight: bold; }
    .matrix-cell.pass { background: #dcfce7; color: #166534; }
    .matrix-cell.fail { background: #fee2e2; color: #991b1b; }
    .matrix-cell.pass-all { background: #dcfce7; color: #166534; font-weight: bold; }
    .matrix-cell.pass-most { background: #d1fae5; color: #065f46; }
    .matrix-cell.pass-some { background: #ffedd5; color: #9a3412; }
    .matrix-cell.fail-all { background: #fee2e2; color: #991b1b; font-weight: bold; }
    .chart-card { background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .chart-legend { display: flex; gap: 1.5rem; margin-bottom: 1rem; font-size: 0.8rem; color: #374151; }
    .chart-legend .legend-item { display: flex; align-items: center; gap: 0.4rem; }
    .chart-legend .legend-dot { width: 14px; height: 14px; border-radius: 3px; }
    .chart-legend .legend-dot.bar-first { background: #22c55e; }
    .chart-legend .legend-dot.bar-second { background: #3b82f6; }
    .h-bar-chart .bar-row { display: flex; align-items: center; margin-bottom: 0.5rem; }
    .h-bar-chart .bar-label { width: 180px; font-size: 0.8rem; color: #2563eb; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; flex-shrink: 0; text-decoration: none; }
    .h-bar-chart a.bar-label:hover { text-decoration: underline; }
    .h-bar-chart .bar-container { flex: 1; height: 24px; background: #f3f4f6; border-radius: 4px; margin: 0 0.75rem; overflow: hidden; display: flex; }
    .h-bar-chart .bar-fill { height: 100%; transition: width 0.3s; display: flex; align-items: center; justify-content: center; position: relative; }
    .h-bar-chart .bar-fill.bar-first { background: #22c55e; border-radius: 4px 0 0 4px; }
    .h-bar-chart .bar-fill.bar-second { background: #3b82f6; border-radius: 0 4px 4px 0; }
    .h-bar-chart .bar-pct { font-size: 0.7rem; font-weight: 600; color: white; text-shadow: 0 1px 2px rgba(0,0,0,0.3); }
    .h-bar-chart .bar-value { width: 50px; font-size: 0.8rem; font-weight: 600; color: #374151; text-align: right; }
    @media (max-width: 768px) {
      .result-matrix { font-size: 0.7rem; }
      .result-matrix th, .result-matrix td { padding: 0.25rem; }
    }
    .theme-toggle { position: fixed; top: 1rem; right: 1rem; z-index: 100; background: #e5e7eb; border: none; border-radius: 2rem; padding: 0.5rem 1rem; cursor: pointer; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; transition: background 0.2s, color 0.2s; }
    .theme-toggle:hover { background: #d1d5db; }
    .theme-toggle .icon { font-size: 1rem; }
    .summary-metrics { margin-bottom: 2rem; }
    .summary-grid { display: flex; flex-wrap: wrap; gap: 1rem; justify-content: center; }
    .summary-card { background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1rem 1.5rem; text-align: center; min-width: 140px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .summary-value { font-size: 1.5rem; font-weight: bold; color: #1f2937; }
    .summary-label { font-size: 0.75rem; color: #6b7280; margin-top: 0.25rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .report-footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb; text-align: center; font-size: 0.75rem; color: #9ca3af; }
    .report-footer p { margin: 0.25rem 0; }
    .report-footer a { color: #6b7280; text-decoration: none; }
    .report-footer a:hover { text-decoration: underline; }
    /* Attempt pill badges */
    .attempt-pills { display: flex; flex-wrap: wrap; gap: 0.375rem; align-items: center; margin: 0.25rem 0 0.5rem; }
    .attempt-pill { display: inline-flex; align-items: center; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; line-height: 1.5; white-space: nowrap; cursor: help; }
    .attempt-pill-1st { background: #dcfce7; color: #166534; }
    .attempt-pill-2nd { background: #dbeafe; color: #1e40af; }
    .attempt-pill-3rd { background: #f3e8ff; color: #6b21a8; }
    .attempt-pill-4th { background: #fef3c7; color: #92400e; }
    .attempt-pill-5th { background: #fce7f3; color: #9d174d; }
    .attempt-pill-failed { background: #f3f4f6; color: #6b7280; }
    .attempt-total { font-size: 0.8125rem; font-weight: 600; color: #1f2937; margin-left: 0.25rem; }
    body.dark { background: #111827; color: #f3f4f6; }
    body.dark header h1 { color: #60a5fa; }
    body.dark header p { color: #9ca3af; }
    body.dark .header-links a { color: #60a5fa; }
    body.dark h2 { color: #f3f4f6; border-bottom-color: #374151; }
    body.dark .theme-toggle { background: #374151; color: #f3f4f6; }
    body.dark .theme-toggle:hover { background: #4b5563; }
    body.dark .metric-card { background: #1f2937; border-color: #374151; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
    body.dark .metric-card.success { border-color: #10b981; background: #064e3b; }
    body.dark .metric-card.error { border-color: #ef4444; background: #7f1d1d; }
    body.dark .metric-value { color: #f3f4f6; }
    body.dark .metric-label { color: #9ca3af; }
    body.dark .model-card { background: #1f2937; border-color: #374151; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
    body.dark .model-card h3 { color: #f3f4f6; }
    body.dark .model-card h3 a { color: #60a5fa; }
    body.dark .card-details-link { color: #60a5fa; }
    body.dark .stat-label { color: #9ca3af; }
    body.dark .stat-value { color: #f3f4f6; }
    body.dark .shortcomings-section { border-top-color: #374151; }
    body.dark .shortcomings-section h4 { color: #9ca3af; }
    body.dark .shortcoming-concept { color: #f87171; }
    body.dark .shortcoming-count { color: #9ca3af; }
    body.dark .shortcomings-more { color: #6b7280; }
    body.dark .view-all-link { color: #60a5fa; }
    body.dark .has-tooltip::after { background: #374151; }
    body.dark .chart-card { background: #1f2937; border-color: #374151; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
    body.dark .chart-legend { color: #d1d5db; }
    body.dark .h-bar-chart .bar-label { color: #60a5fa; }
    body.dark .h-bar-chart a.bar-label:hover { color: #60a5fa; }
    body.dark .h-bar-chart .bar-container { background: #374151; }
    body.dark .h-bar-chart .bar-value { color: #d1d5db; }
    body.dark .matrix-legend { color: #9ca3af; }
    body.dark .matrix-container { background: #1f2937; border-color: #374151; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
    body.dark .result-matrix th, body.dark .result-matrix td { border-color: #374151; }
    body.dark .result-matrix th { background: #111827; color: #d1d5db; }
    body.dark .result-matrix .task-id { background: #111827; color: #f3f4f6; }
    body.dark .result-matrix .task-desc { color: #9ca3af; }
    body.dark .matrix-cell.pass { background: #064e3b; color: #34d399; }
    body.dark .matrix-cell.fail { background: #7f1d1d; color: #fca5a5; }
    body.dark .matrix-cell.pass-all { background: #064e3b; color: #34d399; font-weight: bold; }
    body.dark .matrix-cell.pass-most { background: #065f46; color: #6ee7b7; }
    body.dark .matrix-cell.pass-some { background: #78350f; color: #fdba74; }
    body.dark .matrix-cell.fail-all { background: #7f1d1d; color: #fca5a5; font-weight: bold; }
    body.dark .summary-card { background: #1f2937; border-color: #374151; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
    body.dark .summary-value { color: #f3f4f6; }
    body.dark .summary-label { color: #9ca3af; }
    body.dark .report-footer { border-top-color: #374151; color: #6b7280; }
    body.dark .report-footer a { color: #9ca3af; }
    body.dark .attempt-pill-1st { background: #166534; color: #86efac; }
    body.dark .attempt-pill-2nd { background: #1e3a5f; color: #93c5fd; }
    body.dark .attempt-pill-3rd { background: #3b1a5e; color: #c4b5fd; }
    body.dark .attempt-pill-4th { background: #78350f; color: #fcd34d; }
    body.dark .attempt-pill-5th { background: #831843; color: #f9a8d4; }
    body.dark .attempt-pill-failed { background: #374151; color: #9ca3af; }
    body.dark .attempt-total { color: #f3f4f6; }
    /* Theme navigation grid on index page */
    .themes-section h2 { color: #1f2937; margin: 2rem 0 1rem; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
    .themes-section > p { color: #6b7280; margin-bottom: 1rem; }
    .themes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; }
    .theme-card { display: block; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1rem; text-decoration: none; color: inherit; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.1); transition: border-color 0.2s, box-shadow 0.2s; }
    .theme-card:hover { border-color: #2563eb; box-shadow: 0 2px 8px rgba(37,99,235,0.15); }
    .theme-card h3 { margin: 0 0 0.5rem; font-size: 1rem; color: #1f2937; }
    .theme-card .theme-description { margin: 0 0 0.75rem; font-size: 0.8rem; color: #6b7280; line-height: 1.4; }
    .theme-card .theme-stats { display: flex; justify-content: space-between; font-size: 0.8rem; color: #4b5563; }
    .theme-card .theme-pass-rate { font-weight: 600; color: #059669; }
    /* Theme subpage navigation bar */
    .theme-nav { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.5rem; }
    .theme-nav a { padding: 0.25rem 0.75rem; border-radius: 4px; border: 1px solid #e5e7eb; text-decoration: none; font-size: 0.85rem; color: #374151; transition: background 0.2s, border-color 0.2s; }
    .theme-nav a:hover { border-color: #2563eb; background: #eff6ff; }
    .theme-nav a.active { background: #2563eb; color: white; border-color: #2563eb; }
    /* Theme header */
    .theme-header { margin-bottom: 2rem; }
    .theme-header h1 { margin: 0 0 0.5rem; color: #1f2937; }
    .theme-header .theme-description { color: #6b7280; font-size: 1.1rem; margin: 0 0 0.5rem; }
    .back-link { display: inline-block; margin-bottom: 1.5rem; color: #2563eb; text-decoration: none; font-weight: 500; }
    .back-link:hover { text-decoration: underline; }
    /* Dark mode for theme elements */
    body.dark .themes-section h2 { color: #f3f4f6; border-bottom-color: #374151; }
    body.dark .themes-section > p { color: #9ca3af; }
    body.dark .theme-card { background: #1f2937; border-color: #374151; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
    body.dark .theme-card:hover { border-color: #60a5fa; box-shadow: 0 2px 8px rgba(96,165,250,0.15); }
    body.dark .theme-card h3 { color: #f3f4f6; }
    body.dark .theme-card .theme-description { color: #9ca3af; }
    body.dark .theme-card .theme-stats { color: #d1d5db; }
    body.dark .theme-card .theme-pass-rate { color: #34d399; }
    body.dark .theme-nav a { border-color: #374151; color: #d1d5db; }
    body.dark .theme-nav a:hover { border-color: #60a5fa; background: #1e3a5f; }
    body.dark .theme-nav a.active { background: #2563eb; color: white; border-color: #2563eb; }
    body.dark .theme-header h1 { color: #f3f4f6; }
    body.dark .theme-header .theme-description { color: #9ca3af; }
    body.dark .back-link { color: #60a5fa; }
    /* Chart CSS custom properties */
    :root {
    --cg-chart-text: #374151;
    --cg-chart-grid: #e5e7eb;
    --cg-chart-bg: white;
    --cg-chart-axis: #6b7280;
    --cg-chart-muted: #9ca3af;
    --cg-model-0: #2563eb;
    --cg-model-1: #dc2626;
    --cg-model-2: #059669;
    --cg-model-3: #d97706;
    --cg-model-4: #7c3aed;
    --cg-model-5: #db2777;
    --cg-model-6: #0891b2;
    --cg-model-7: #ea580c;
    --cg-model-8: #4f46e5;
    --cg-model-9: #65a30d;
    --cg-model-10: #be185d;
    --cg-model-11: #0d9488;
    --cg-model-12: #9333ea;
    --cg-model-13: #ca8a04;
    --cg-model-14: #475569;
    --cg-model-15: #b91c1c;
    }
    body.dark {
    --cg-chart-text: #d1d5db;
    --cg-chart-grid: #374151;
    --cg-chart-bg: #1f2937;
    --cg-chart-axis: #9ca3af;
    --cg-chart-muted: #6b7280;
    --cg-model-0: #60a5fa;
    --cg-model-1: #f87171;
    --cg-model-2: #34d399;
    --cg-model-3: #fbbf24;
    --cg-model-4: #a78bfa;
    --cg-model-5: #f472b6;
    --cg-model-6: #22d3ee;
    --cg-model-7: #fb923c;
    --cg-model-8: #818cf8;
    --cg-model-9: #a3e635;
    --cg-model-10: #fb7185;
    --cg-model-11: #2dd4bf;
    --cg-model-12: #c084fc;
    --cg-model-13: #facc15;
    --cg-model-14: #94a3b8;
    --cg-model-15: #fca5a5;
    }
    /* Analytics sections */
    .analytics-sections { margin: 2.25rem 0; }
    .analytics-sections > h2 { color: #1f2937; margin: 2rem 0 0.5rem; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
    .analytics-intro { color: #6b7280; font-size: 0.95rem; margin: 0 0 1.25rem; }
    .analytics-section { background: white; border: 1px solid #e5e7eb; border-radius: 0.6rem; padding: 1.25rem 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); position: relative; }
    .analytics-section::before { content: ""; position: absolute; left: 0; top: 0; height: 3px; width: 100%; background: linear-gradient(90deg, #2563eb, #22c55e); border-top-left-radius: 0.6rem; border-top-right-radius: 0.6rem; }
    .analytics-section h3 { margin: 0 0 0.85rem; font-size: 1.05rem; color: #111827; letter-spacing: 0.01em; }
    .chart-container { max-width: 100%; overflow-x: auto; padding-bottom: 0.25rem; }
    .chart-container svg.analytics-chart { width: 100%; height: auto; min-width: 640px; }
    /* Analytics legend */
    .chart-legend-inline { display: flex; flex-wrap: wrap; gap: 0.85rem; margin: 0.25rem 0 0.75rem; font-size: 0.82rem; }
    .chart-legend-item { display: inline-flex; align-items: center; gap: 0.4rem; }
    .chart-legend-dot { display: inline-block; width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
    .chart-legend-label { color: #374151; white-space: nowrap; }
    .chart-legend-more { color: #9ca3af; font-style: italic; }
    /* Heatmap table */
    .analytics-heatmap { border-collapse: collapse; width: 100%; font-size: 0.75rem; }
    .analytics-heatmap th, .analytics-heatmap td { padding: 0.35rem 0.5rem; border: 1px solid #e5e7eb; text-align: center; }
    .analytics-heatmap th { background: #f9fafb; font-weight: 600; color: #374151; white-space: nowrap; font-size: 0.7rem; }
    .analytics-heatmap .row-label { text-align: left; font-weight: 500; color: #374151; white-space: nowrap; max-width: 180px; overflow: hidden; text-overflow: ellipsis; position: sticky; left: 0; background: #f9fafb; }
    .analytics-heatmap td.cell-pass { background: #dcfce7; color: #166534; }
    .analytics-heatmap td.cell-fail { background: #fee2e2; color: #991b1b; }
    .analytics-heatmap td.cell-na { background: #f3f4f6; color: #9ca3af; }
    .analytics-heatmap td.cell-gradient { font-weight: 600; font-size: 0.7rem; }
    .analytics-heatmap .difficulty-band { background: #f1f5f9; font-weight: 700; color: #475569; text-align: left; padding: 0.4rem 0.75rem; font-size: 0.8rem; }
    .heatmap-scroll { overflow-x: auto; }
    /* Analytics dark mode */
    body.dark .analytics-sections > h2 { color: #f3f4f6; border-bottom-color: #374151; }
    body.dark .analytics-intro { color: #9ca3af; }
    body.dark .analytics-section { background: #1f2937; border-color: #374151; box-shadow: 0 1px 3px rgba(0,0,0,0.28); }
    body.dark .analytics-section::before { background: linear-gradient(90deg, #60a5fa, #34d399); }
    body.dark .analytics-section h3 { color: #f3f4f6; }
    body.dark .chart-legend-label { color: #d1d5db; }
    body.dark .chart-legend-more { color: #6b7280; }
    body.dark .analytics-heatmap th { background: #111827; border-color: #374151; color: #d1d5db; }
    body.dark .analytics-heatmap td { border-color: #374151; }
    body.dark .analytics-heatmap .row-label { background: #111827; color: #d1d5db; }
    body.dark .analytics-heatmap td.cell-pass { background: #064e3b; color: #34d399; }
    body.dark .analytics-heatmap td.cell-fail { background: #7f1d1d; color: #fca5a5; }
    body.dark .analytics-heatmap td.cell-na { background: #1f2937; color: #6b7280; }
    body.dark .analytics-heatmap .difficulty-band { background: #1e293b; color: #94a3b8; }
`;

/**
 * CSS styles for model detail pages
 */
export const MODEL_DETAIL_STYLES = `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    h1 { color: #1f2937; margin: 0 0 0.5rem; font-size: 1.5rem; word-break: break-all; }
    h2 { color: #1f2937; margin: 2rem 0 1rem; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
    p { color: #6b7280; margin: 0.5rem 0; }
    .back-link { display: inline-block; margin-bottom: 1.5rem; color: #2563eb; text-decoration: none; font-weight: 500; }
    .back-link:hover { text-decoration: underline; }
    .header-links { margin: 1rem 0; text-align: center; }
    .header-links a { color: #2563eb; text-decoration: none; margin: 0 0.75rem; font-weight: 500; }
    .header-links a:hover { text-decoration: underline; }
    .model-header { background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .model-meta { display: flex; gap: 2rem; flex-wrap: wrap; margin-top: 1rem; }
    .model-meta .stat { font-size: 0.9rem; }
    .model-meta .stat-label { color: #6b7280; margin-right: 0.25rem; }
    .model-meta .stat-value { font-weight: 600; color: #1f2937; }
    .stats-grid { display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem; }
    .stats-grid .stat-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 0.75rem 1.25rem; text-align: center; min-width: 120px; }
    .stats-grid .stat-card-value { font-size: 1.25rem; font-weight: bold; color: #1f2937; }
    .stats-grid .stat-card-label { font-size: 0.75rem; color: #6b7280; margin-top: 0.25rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .attempt-pills { display: flex; flex-wrap: wrap; gap: 0.375rem; align-items: center; margin: 0.25rem 0 0.5rem; }
    .attempt-pill { display: inline-flex; align-items: center; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; line-height: 1.5; white-space: nowrap; cursor: help; }
    .attempt-pill-1st { background: #dcfce7; color: #166534; }
    .attempt-pill-2nd { background: #dbeafe; color: #1e40af; }
    .attempt-pill-3rd { background: #f3e8ff; color: #6b21a8; }
    .attempt-pill-4th { background: #fef3c7; color: #92400e; }
    .attempt-pill-5th { background: #fce7f3; color: #9d174d; }
    .attempt-pill-failed { background: #f3f4f6; color: #6b7280; }
    .attempt-total { font-size: 0.8125rem; font-weight: 600; color: #1f2937; margin-left: 0.25rem; }
    .shortcomings-table { width: 100%; border-collapse: collapse; background: white; border-radius: 0.5rem; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .shortcomings-table th { background: #f9fafb; text-align: left; padding: 0.75rem; border-bottom: 2px solid #e5e7eb; font-weight: 600; color: #374151; }
    .shortcomings-table td { padding: 0.75rem; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    .shortcomings-table .rank { width: 40px; text-align: center; font-weight: 500; }
    .shortcomings-table .concept { font-weight: 500; color: #dc2626; }
    .shortcomings-table .al-concept { color: #6b7280; font-size: 0.875rem; }
    .shortcomings-table .count { text-align: center; font-weight: 600; }
    .shortcomings-table .tasks { font-family: monospace; font-size: 0.8rem; color: #4b5563; }
    .shortcoming-row { background: white; }
    .description-row { background: #f9fafb; }
    .description-content { padding: 0.5rem; font-size: 0.875rem; line-height: 1.6; color: #374151; }
    .code-patterns { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem; }
    @media (max-width: 768px) { .code-patterns { grid-template-columns: 1fr; } }
    .pattern { border-radius: 0.5rem; padding: 0.75rem; }
    .pattern.correct { background: #dcfce7; border: 1px solid #86efac; }
    .pattern.incorrect { background: #fee2e2; border: 1px solid #fca5a5; }
    .pattern-label { display: block; font-weight: 600; margin-bottom: 0.5rem; font-size: 0.75rem; text-transform: uppercase; color: #374151; }
    .pattern pre { margin: 0; overflow-x: auto; font-size: 0.75rem; background: rgba(0,0,0,0.05); padding: 0.5rem; border-radius: 0.25rem; }
    .pattern code { white-space: pre-wrap; word-break: break-word; }
    .error-codes { margin-top: 0.75rem; font-family: monospace; color: #6b7280; }
    .theme-toggle { position: fixed; top: 1rem; right: 1rem; z-index: 100; background: #e5e7eb; border: none; border-radius: 2rem; padding: 0.5rem 1rem; cursor: pointer; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; transition: background 0.2s, color 0.2s; }
    .theme-toggle:hover { background: #d1d5db; }
    .theme-toggle .icon { font-size: 1rem; }
    /* Dark mode */
    body.dark { background: #111827; color: #f3f4f6; }
    body.dark h1, body.dark h2 { color: #f3f4f6; }
    body.dark h2 { border-bottom-color: #374151; }
    body.dark p { color: #9ca3af; }
    body.dark .back-link { color: #60a5fa; }
    body.dark .header-links a { color: #60a5fa; }
    body.dark .theme-toggle { background: #374151; color: #f3f4f6; }
    body.dark .theme-toggle:hover { background: #4b5563; }
    body.dark .model-header { background: #1f2937; border-color: #374151; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
    body.dark .model-meta .stat-label { color: #9ca3af; }
    body.dark .model-meta .stat-value { color: #f3f4f6; }
    body.dark .stats-grid .stat-card { background: #111827; border-color: #374151; }
    body.dark .stats-grid .stat-card-value { color: #f3f4f6; }
    body.dark .stats-grid .stat-card-label { color: #9ca3af; }
    body.dark .attempt-pill-1st { background: #166534; color: #86efac; }
    body.dark .attempt-pill-2nd { background: #1e3a5f; color: #93c5fd; }
    body.dark .attempt-pill-3rd { background: #3b1a5e; color: #c4b5fd; }
    body.dark .attempt-pill-4th { background: #78350f; color: #fcd34d; }
    body.dark .attempt-pill-5th { background: #831843; color: #f9a8d4; }
    body.dark .attempt-pill-failed { background: #374151; color: #9ca3af; }
    body.dark .attempt-total { color: #f3f4f6; }
    body.dark .shortcomings-table { background: #1f2937; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
    body.dark .shortcomings-table th { background: #111827; border-color: #374151; color: #d1d5db; }
    body.dark .shortcomings-table td { border-color: #374151; }
    body.dark .shortcomings-table .concept { color: #f87171; }
    body.dark .shortcomings-table .al-concept { color: #9ca3af; }
    body.dark .shortcomings-table .tasks { color: #9ca3af; }
    body.dark .shortcoming-row { background: #1f2937; }
    body.dark .description-row { background: #111827; }
    body.dark .description-content { color: #d1d5db; }
    body.dark .pattern.correct { background: #064e3b; border-color: #10b981; }
    body.dark .pattern.incorrect { background: #7f1d1d; border-color: #ef4444; }
    body.dark .pattern-label { color: #d1d5db; }
    body.dark .pattern pre { background: rgba(0,0,0,0.3); }
    body.dark .error-codes { color: #9ca3af; }
`;

/**
 * JavaScript for theme toggle functionality
 */
export const THEME_TOGGLE_SCRIPT = `
    (function() {
      const toggle = document.getElementById('theme-toggle');
      const icon = document.getElementById('theme-icon');
      const label = document.getElementById('theme-label');
      function setTheme(dark) {
        document.body.classList.toggle('dark', dark);
        icon.innerHTML = dark ? '&#9788;' : '&#9790;';
        label.textContent = dark ? 'Light' : 'Dark';
        localStorage.setItem('cg-theme', dark ? 'dark' : 'light');
      }
      const saved = localStorage.getItem('cg-theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const isDark = saved === 'dark' || (!saved && prefersDark);
      setTheme(isDark);
      toggle.addEventListener('click', function() {
        setTheme(!document.body.classList.contains('dark'));
      });
    })();
`;

/**
 * Theme toggle button HTML
 */
export const THEME_TOGGLE_BUTTON = `
  <button class="theme-toggle" id="theme-toggle" aria-label="Toggle dark mode">
    <span class="icon" id="theme-icon">&#9790;</span>
    <span id="theme-label">Dark</span>
  </button>
`;
