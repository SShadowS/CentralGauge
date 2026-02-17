/**
 * Dashboard page generator - complete HTML document with embedded CSS and JS
 * @module cli/dashboard/page
 */

/**
 * Generate the complete dashboard HTML page.
 * Includes all CSS and JS inline - no external dependencies.
 */
export function generateDashboardPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CentralGauge Live Dashboard</title>
<style>
${DASHBOARD_CSS}
</style>
</head>
<body>
<div class="dashboard">
  <!-- Header -->
  <header class="dash-header">
    <div class="dash-header-left">
      <h1>CentralGauge <span class="live-dot"></span><span class="live-text">Live</span></h1>
      <span class="run-counter" id="run-counter"></span>
    </div>
    <div class="dash-header-right">
      <button class="theme-toggle" id="theme-toggle" aria-label="Toggle dark mode">
        <span class="icon" id="theme-icon">&#9790;</span>
        <span id="theme-label">Dark</span>
      </button>
    </div>
  </header>

  <!-- Progress bar -->
  <div class="progress-section" id="progress-section">
    <div class="progress-bar-container">
      <div class="progress-bar-fill" id="progress-bar" style="width: 0%"></div>
      <span class="progress-bar-text" id="progress-text">0%</span>
    </div>
    <div class="progress-stats">
      <span id="progress-elapsed">0s</span>
      <span id="progress-eta"></span>
      <span id="progress-cells">0 / 0</span>
      <span id="progress-llm">LLM: 0</span>
      <span id="progress-queue">Queue: 0</span>
      <span id="progress-cost">$0.00</span>
    </div>
  </div>

  <!-- Model summary cards -->
  <div class="model-cards" id="model-cards"></div>

  <!-- Bar chart -->
  <div class="chart-section" id="chart-section">
    <h2>Pass Rate by Model</h2>
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-dot" style="background:#22c55e"></span> 1st attempt</span>
      <span class="legend-item"><span class="legend-dot" style="background:#3b82f6"></span> 2nd attempt</span>
    </div>
    <div class="bar-chart" id="bar-chart"></div>
  </div>

  <!-- Matrix grid -->
  <div class="matrix-section">
    <h2>Task &times; Model Matrix</h2>
    <div class="matrix-legend">
      <span class="legend-cell pending"></span> Pending
      <span class="legend-cell llm"></span> LLM
      <span class="legend-cell compiling"></span> Compiling
      <span class="legend-cell testing"></span> Testing
      <span class="legend-cell pass"></span> Pass
      <span class="legend-cell fail"></span> Fail
      <span class="legend-cell compile-error"></span> Compile Error
      <span class="legend-cell error"></span> Error
    </div>
    <div class="matrix-container" id="matrix-container">
      <table class="result-matrix" id="matrix-table">
        <thead id="matrix-head"></thead>
        <tbody id="matrix-body"></tbody>
      </table>
    </div>
  </div>

  <!-- Activity log -->
  <div class="log-section">
    <h2>Activity Log</h2>
    <div class="log-container" id="log-container"></div>
  </div>

  <!-- Completion banner -->
  <div class="completion-banner" id="completion-banner" style="display:none">
    <h2>Benchmark Complete</h2>
    <p>All tasks finished. This dashboard will remain available until you close the terminal (Ctrl+C).</p>
  </div>
</div>

<script>
${DASHBOARD_JS}
</script>
</body>
</html>`;
}

const DASHBOARD_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #f5f5f5;
  color: #1f2937;
  line-height: 1.5;
}
.dashboard { max-width: 1400px; margin: 0 auto; padding: 1rem 1.5rem; }

/* Header */
.dash-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 2px solid #e5e7eb;
}
.dash-header-left { display: flex; align-items: center; gap: 1rem; }
.dash-header h1 { font-size: 1.5rem; color: #2563eb; display: flex; align-items: center; gap: 0.5rem; }
.live-dot {
  display: inline-block; width: 10px; height: 10px; background: #22c55e;
  border-radius: 50%; animation: pulse-dot 2s infinite;
}
.live-text { color: #22c55e; font-size: 0.875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
.run-counter { font-size: 0.875rem; color: #6b7280; font-weight: 500; }

/* Theme toggle */
.theme-toggle {
  background: #e5e7eb; border: none; border-radius: 2rem; padding: 0.4rem 0.8rem;
  cursor: pointer; font-size: 0.8rem; display: flex; align-items: center; gap: 0.3rem;
  transition: background 0.2s;
}
.theme-toggle:hover { background: #d1d5db; }

/* Progress */
.progress-section { margin-bottom: 1.25rem; }
.progress-bar-container {
  height: 28px; background: #e5e7eb; border-radius: 6px; position: relative; overflow: hidden;
}
.progress-bar-fill {
  height: 100%; background: linear-gradient(90deg, #2563eb, #22c55e);
  border-radius: 6px; transition: width 0.5s ease; min-width: 0;
}
.progress-bar-text {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-size: 0.8rem; font-weight: 700; color: #1f2937; text-shadow: 0 0 4px rgba(255,255,255,0.8);
}
.progress-stats {
  display: flex; gap: 1.25rem; margin-top: 0.5rem; font-size: 0.8rem; color: #6b7280;
  flex-wrap: wrap;
}
.progress-stats span { white-space: nowrap; }

/* Model cards */
.model-cards {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.75rem; margin-bottom: 1.25rem;
}
.model-card {
  background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem;
  padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  transition: border-color 0.3s;
}
.model-card .model-name {
  font-size: 0.8rem; font-weight: 600; color: #374151;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 0.5rem;
}
.model-card .pass-rate {
  font-size: 1.75rem; font-weight: 700; line-height: 1;
}
.model-card .card-stats {
  display: flex; gap: 0.75rem; margin-top: 0.5rem; font-size: 0.75rem; color: #6b7280;
}
.pass-rate.high { color: #16a34a; }
.pass-rate.mid { color: #d97706; }
.pass-rate.low { color: #dc2626; }
.pass-rate.none { color: #9ca3af; }

/* Chart */
.chart-section {
  background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem;
  padding: 1.25rem; margin-bottom: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.chart-section h2 { font-size: 1rem; color: #374151; margin-bottom: 0.5rem; }
.chart-legend {
  display: flex; gap: 1rem; font-size: 0.75rem; color: #6b7280; margin-bottom: 0.75rem;
}
.legend-item { display: flex; align-items: center; gap: 0.3rem; }
.legend-dot { width: 12px; height: 12px; border-radius: 3px; }
.bar-chart .bar-row { display: flex; align-items: center; margin-bottom: 0.4rem; }
.bar-chart .bar-label {
  width: 160px; font-size: 0.8rem; color: #374151; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0;
}
.bar-chart .bar-track {
  flex: 1; height: 22px; background: #f3f4f6; border-radius: 4px;
  margin: 0 0.5rem; overflow: hidden; display: flex;
}
.bar-chart .bar-fill {
  height: 100%; display: flex; align-items: center; justify-content: center;
  transition: width 0.5s ease; position: relative;
}
.bar-chart .bar-fill.first { background: #22c55e; border-radius: 4px 0 0 4px; }
.bar-chart .bar-fill.second { background: #3b82f6; }
.bar-chart .bar-pct {
  font-size: 0.65rem; font-weight: 700; color: white; text-shadow: 0 1px 2px rgba(0,0,0,0.3);
}
.bar-chart .bar-value { width: 45px; font-size: 0.8rem; font-weight: 600; color: #374151; text-align: right; }

/* Matrix */
.matrix-section { margin-bottom: 1.25rem; }
.matrix-section h2 { font-size: 1rem; color: #374151; margin-bottom: 0.5rem; }
.matrix-legend {
  display: flex; gap: 0.75rem; flex-wrap: wrap; font-size: 0.75rem; color: #6b7280;
  margin-bottom: 0.5rem; align-items: center;
}
.legend-cell {
  display: inline-block; width: 14px; height: 14px; border-radius: 3px;
  margin-right: 0.15rem; vertical-align: middle;
}
.legend-cell.pending { background: #e5e7eb; }
.legend-cell.llm { background: #3b82f6; }
.legend-cell.compiling { background: #f59e0b; }
.legend-cell.testing { background: #6366f1; }
.legend-cell.pass { background: #22c55e; }
.legend-cell.fail { background: #ef4444; }
.legend-cell.compile-error { background: #f97316; }
.legend-cell.error { background: #991b1b; }

.matrix-container { overflow-x: auto; background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
.result-matrix { border-collapse: collapse; width: 100%; font-size: 0.8rem; }
.result-matrix th, .result-matrix td { padding: 0.35rem 0.5rem; text-align: center; border: 1px solid #e5e7eb; }
.result-matrix th { background: #f9fafb; font-weight: 600; color: #374151; white-space: nowrap; font-size: 0.75rem; }
.result-matrix .task-id {
  text-align: left; font-family: monospace; font-weight: 500; white-space: nowrap;
  background: #f9fafb; position: sticky; left: 0; z-index: 1;
}
.result-matrix .model-group { border-bottom: 2px solid #d1d5db; }

/* Cell states */
.cell { width: 2.5rem; height: 1.75rem; font-weight: 600; font-size: 0.7rem; transition: background 0.3s; position: relative; }
.cell.pending { background: #f3f4f6; color: #9ca3af; }
.cell.llm { background: #dbeafe; color: #1e40af; animation: pulse 2s infinite; }
.cell.compiling { background: #fef3c7; color: #92400e; animation: pulse 2s infinite; }
.cell.testing { background: #e0e7ff; color: #3730a3; animation: pulse 2s infinite; }
.cell.pass { background: #dcfce7; color: #166534; }
.cell.fail { background: #fee2e2; color: #991b1b; }
.cell.compile-error { background: #ffedd5; color: #9a3412; }
.cell.error { background: #fecaca; color: #7f1d1d; }

/* Cell labels */
.cell.pass::after { content: attr(data-score); }
.cell.fail::after { content: attr(data-info); }
.cell.compile-error::after { content: "CE"; }
.cell.error::after { content: "ERR"; }
.cell.llm::after { content: "LLM"; }
.cell.compiling::after { content: "CC"; }
.cell.testing::after { content: "TST"; }
.cell.pending::after { content: "\\00B7"; font-size: 1.2rem; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34,197,94,0.4); }
  50% { opacity: 0.7; box-shadow: 0 0 0 4px rgba(34,197,94,0); }
}

/* Activity log */
.log-section { margin-bottom: 1.25rem; }
.log-section h2 { font-size: 1rem; color: #374151; margin-bottom: 0.5rem; }
.log-container {
  background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem;
  padding: 0.75rem; max-height: 200px; overflow-y: auto; font-family: monospace;
  font-size: 0.75rem; color: #374151; box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.log-entry { padding: 0.15rem 0; border-bottom: 1px solid #f3f4f6; }
.log-entry:last-child { border-bottom: none; }
.log-time { color: #9ca3af; margin-right: 0.5rem; }
.log-pass { color: #16a34a; }
.log-fail { color: #dc2626; }
.log-info { color: #2563eb; }

/* Completion banner */
.completion-banner {
  background: #f0fdf4; border: 2px solid #22c55e; border-radius: 0.5rem;
  padding: 1.25rem; text-align: center; margin-bottom: 1.25rem;
}
.completion-banner h2 { color: #166534; font-size: 1.25rem; margin-bottom: 0.25rem; }
.completion-banner p { color: #4b5563; font-size: 0.875rem; }

/* Dark mode */
body.dark { background: #111827; color: #f3f4f6; }
body.dark .dash-header { border-bottom-color: #374151; }
body.dark .dash-header h1 { color: #60a5fa; }
body.dark .run-counter { color: #9ca3af; }
body.dark .theme-toggle { background: #374151; color: #f3f4f6; }
body.dark .theme-toggle:hover { background: #4b5563; }
body.dark .progress-bar-container { background: #374151; }
body.dark .progress-bar-text { color: #f3f4f6; text-shadow: 0 0 4px rgba(0,0,0,0.8); }
body.dark .progress-stats { color: #9ca3af; }
body.dark .model-card { background: #1f2937; border-color: #374151; }
body.dark .model-card .model-name { color: #d1d5db; }
body.dark .model-card .card-stats { color: #9ca3af; }
body.dark .chart-section { background: #1f2937; border-color: #374151; }
body.dark .chart-section h2 { color: #f3f4f6; }
body.dark .chart-legend { color: #9ca3af; }
body.dark .bar-chart .bar-label { color: #d1d5db; }
body.dark .bar-chart .bar-track { background: #374151; }
body.dark .bar-chart .bar-value { color: #d1d5db; }
body.dark .matrix-section h2 { color: #f3f4f6; }
body.dark .matrix-legend { color: #9ca3af; }
body.dark .matrix-container { background: #1f2937; border-color: #374151; }
body.dark .result-matrix th, body.dark .result-matrix td { border-color: #374151; }
body.dark .result-matrix th { background: #111827; color: #d1d5db; }
body.dark .result-matrix .task-id { background: #111827; color: #f3f4f6; }
body.dark .cell.pending { background: #1f2937; color: #6b7280; }
body.dark .cell.llm { background: #1e3a5f; color: #93c5fd; }
body.dark .cell.compiling { background: #78350f; color: #fcd34d; }
body.dark .cell.testing { background: #312e81; color: #a5b4fc; }
body.dark .cell.pass { background: #064e3b; color: #34d399; }
body.dark .cell.fail { background: #7f1d1d; color: #fca5a5; }
body.dark .cell.compile-error { background: #7c2d12; color: #fdba74; }
body.dark .cell.error { background: #450a0a; color: #fca5a5; }
body.dark .log-section h2 { color: #f3f4f6; }
body.dark .log-container { background: #1f2937; border-color: #374151; color: #d1d5db; }
body.dark .log-entry { border-bottom-color: #374151; }
body.dark .log-time { color: #6b7280; }
body.dark .completion-banner { background: #064e3b; border-color: #10b981; }
body.dark .completion-banner h2 { color: #34d399; }
body.dark .completion-banner p { color: #d1d5db; }

/* Responsive */
@media (max-width: 768px) {
  .dashboard { padding: 0.75rem; }
  .model-cards { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .bar-chart .bar-label { width: 100px; }
}
`;

const DASHBOARD_JS = `
(function() {
  'use strict';

  // State
  let state = null;
  let eventSource = null;
  const logEntries = [];
  const MAX_LOG = 50;

  // DOM refs
  const $ = (id) => document.getElementById(id);

  // ==================== Init ====================

  async function init() {
    setupThemeToggle();
    await fetchInitialState();
    connectSSE();
    startElapsedTimer();
  }

  async function fetchInitialState() {
    try {
      const res = await fetch('/api/state');
      state = await res.json();
      renderAll();
    } catch (e) {
      console.error('Failed to fetch initial state:', e);
    }
  }

  function connectSSE() {
    eventSource = new EventSource('/events');

    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        handleSSEEvent(event);
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    eventSource.onerror = () => {
      // Auto-reconnect is built into EventSource
      // On reconnect, re-fetch full state
      setTimeout(async () => {
        if (eventSource.readyState === EventSource.CONNECTING) {
          await fetchInitialState();
        }
      }, 2000);
    };
  }

  // ==================== Event Handling ====================

  function handleSSEEvent(event) {
    if (!state) return;

    switch (event.type) {
      case 'full-state':
        state = event.state;
        renderAll();
        break;

      case 'cell-update':
        state.cells[event.key] = event.cell;
        renderCell(event.key, event.cell);
        addLogEntry(event.cell);
        break;

      case 'progress':
        state.progress = event.progress;
        renderProgress();
        break;

      case 'model-stats':
        state.modelStats = event.stats;
        renderModelCards();
        renderBarChart();
        break;

      case 'cost-point':
        state.costHistory.push(event.point);
        break;

      case 'benchmark-complete':
        state.isRunning = false;
        renderComplete();
        break;
    }
  }

  // ==================== Rendering ====================

  function renderAll() {
    if (!state) return;
    renderRunCounter();
    renderProgress();
    renderModelCards();
    renderBarChart();
    renderMatrix();
  }

  function renderRunCounter() {
    const el = $('run-counter');
    if (state.totalRuns > 1) {
      el.textContent = 'Run ' + state.currentRun + ' / ' + state.totalRuns;
    } else {
      el.textContent = '';
    }
  }

  function renderProgress() {
    if (!state) return;
    const p = state.progress;
    const pct = p.totalCells > 0 ? ((p.completedCells / p.totalCells) * 100) : 0;

    $('progress-bar').style.width = pct.toFixed(1) + '%';
    $('progress-text').textContent = pct.toFixed(0) + '%';
    $('progress-cells').textContent = p.completedCells + ' / ' + p.totalCells;
    $('progress-llm').textContent = 'LLM: ' + p.activeLLMCalls;
    $('progress-queue').textContent = 'Queue: ' + p.compileQueueLength;
    $('progress-cost').textContent = '$' + (p.totalCost || 0).toFixed(2);

    if (p.estimatedRemainingMs && p.estimatedRemainingMs > 0) {
      $('progress-eta').textContent = 'ETA: ' + formatDuration(p.estimatedRemainingMs);
    } else {
      $('progress-eta').textContent = '';
    }
  }

  function renderModelCards() {
    if (!state) return;
    const container = $('model-cards');
    container.innerHTML = '';

    for (const s of state.modelStats) {
      const total = s.passed + s.failed;
      const rateText = total > 0 ? (s.passRate * 100).toFixed(0) + '%' : '-';
      const rateClass = total === 0 ? 'none' : s.passRate >= 0.7 ? 'high' : s.passRate >= 0.4 ? 'mid' : 'low';

      const card = document.createElement('div');
      card.className = 'model-card';
      card.innerHTML =
        '<div class="model-name" title="' + esc(s.model) + '">' + esc(s.model) + '</div>' +
        '<div class="pass-rate ' + rateClass + '">' + rateText + '</div>' +
        '<div class="card-stats">' +
          '<span>' + s.passed + '/' + total + '</span>' +
          '<span>1st:' + s.attempt1Passes + '</span>' +
          '<span>2nd:' + s.attempt2Passes + '</span>' +
          '<span>$' + s.totalCost.toFixed(2) + '</span>' +
        '</div>';
      container.appendChild(card);
    }
  }

  function renderBarChart() {
    if (!state) return;
    const container = $('bar-chart');
    container.innerHTML = '';

    for (const s of state.modelStats) {
      const total = s.passed + s.failed;
      if (total === 0) continue;

      const pct1 = (s.attempt1Passes / total * 100);
      const pct2 = (s.attempt2Passes / total * 100);

      const row = document.createElement('div');
      row.className = 'bar-row';
      row.innerHTML =
        '<span class="bar-label" title="' + esc(s.model) + '">' + esc(s.model) + '</span>' +
        '<div class="bar-track">' +
          (pct1 > 0 ? '<div class="bar-fill first" style="width:' + pct1.toFixed(1) + '%">' +
            (pct1 >= 8 ? '<span class="bar-pct">' + pct1.toFixed(0) + '%</span>' : '') +
          '</div>' : '') +
          (pct2 > 0 ? '<div class="bar-fill second" style="width:' + pct2.toFixed(1) + '%">' +
            (pct2 >= 8 ? '<span class="bar-pct">' + pct2.toFixed(0) + '%</span>' : '') +
          '</div>' : '') +
        '</div>' +
        '<span class="bar-value">' + (s.passRate * 100).toFixed(0) + '%</span>';
      container.appendChild(row);
    }
  }

  function renderMatrix() {
    if (!state) return;
    const head = $('matrix-head');
    const body = $('matrix-body');
    head.innerHTML = '';
    body.innerHTML = '';

    const models = state.models;
    const taskIds = state.taskIds;
    const totalRuns = state.totalRuns;
    const showRuns = totalRuns > 1;

    // Header row
    let headerHTML = '<tr><th class="task-id">Task</th>';
    for (const model of models) {
      if (showRuns) {
        headerHTML += '<th colspan="' + totalRuns + '" class="model-group">' + esc(model) + '</th>';
      } else {
        headerHTML += '<th>' + esc(model) + '</th>';
      }
    }
    headerHTML += '</tr>';

    // Sub-header for run numbers
    if (showRuns) {
      headerHTML += '<tr><th></th>';
      for (const _model of models) {
        for (let r = 1; r <= totalRuns; r++) {
          headerHTML += '<th>R' + r + '</th>';
        }
      }
      headerHTML += '</tr>';
    }
    head.innerHTML = headerHTML;

    // Body rows
    for (const taskId of taskIds) {
      let rowHTML = '<tr><td class="task-id">' + esc(taskId) + '</td>';
      for (const model of models) {
        if (showRuns) {
          for (let r = 1; r <= totalRuns; r++) {
            const key = taskId + '|' + model + '|' + r;
            const cell = state.cells[key];
            rowHTML += renderCellTD(cell, key);
          }
        } else {
          const key = taskId + '|' + model + '|1';
          const cell = state.cells[key];
          rowHTML += renderCellTD(cell, key);
        }
      }
      rowHTML += '</tr>';
      body.innerHTML += rowHTML;
    }
  }

  function renderCellTD(cell, key) {
    if (!cell) return '<td class="cell pending" id="cell-' + esc(key) + '"></td>';

    const st = cell.state;
    let attrs = '';
    if (st === 'pass' && cell.score !== undefined) {
      attrs = ' data-score="' + cell.score.toFixed(0) + '"';
    } else if (st === 'fail') {
      const info = cell.testsPassed !== undefined ? cell.testsPassed + '/' + cell.testsTotal : 'F';
      attrs = ' data-info="' + info + '"';
    }

    let title = cell.taskId + ' | ' + cell.model;
    if (cell.attempt > 0) title += ' | A' + cell.attempt;
    if (cell.score !== undefined) title += ' | Score: ' + cell.score.toFixed(1);
    if (cell.testsPassed !== undefined) title += ' | Tests: ' + cell.testsPassed + '/' + cell.testsTotal;

    return '<td class="cell ' + st + '" id="cell-' + esc(key) + '"' + attrs + ' title="' + esc(title) + '"></td>';
  }

  function renderCell(key, cell) {
    const el = document.getElementById('cell-' + key);
    if (!el) {
      // Cell might not exist yet if matrix hasn't been rendered for this run
      renderMatrix();
      return;
    }

    el.className = 'cell ' + cell.state;

    // Update data attributes
    if (cell.state === 'pass' && cell.score !== undefined) {
      el.setAttribute('data-score', cell.score.toFixed(0));
    } else if (cell.state === 'fail') {
      const info = cell.testsPassed !== undefined ? cell.testsPassed + '/' + cell.testsTotal : 'F';
      el.setAttribute('data-info', info);
    }

    let title = cell.taskId + ' | ' + cell.model;
    if (cell.attempt > 0) title += ' | A' + cell.attempt;
    if (cell.score !== undefined) title += ' | Score: ' + cell.score.toFixed(1);
    if (cell.testsPassed !== undefined) title += ' | Tests: ' + cell.testsPassed + '/' + cell.testsTotal;
    el.title = title;
  }

  function renderComplete() {
    $('completion-banner').style.display = 'block';
    // Stop the pulse on the live dot
    const dot = document.querySelector('.live-dot');
    if (dot) {
      dot.style.animation = 'none';
      dot.style.background = '#9ca3af';
    }
    const liveText = document.querySelector('.live-text');
    if (liveText) {
      liveText.textContent = 'Complete';
      liveText.style.color = '#9ca3af';
    }
  }

  // ==================== Activity Log ====================

  function addLogEntry(cell) {
    const now = new Date();
    const time = now.toLocaleTimeString();
    let cls = 'log-info';
    let msg = '';

    switch (cell.state) {
      case 'llm':
        msg = cell.taskId + ' | ' + cell.model + ' | LLM attempt ' + cell.attempt;
        break;
      case 'compiling':
        msg = cell.taskId + ' | ' + cell.model + ' | Compiling';
        break;
      case 'testing':
        msg = cell.taskId + ' | ' + cell.model + ' | Running tests';
        break;
      case 'pass':
        cls = 'log-pass';
        msg = cell.taskId + ' | ' + cell.model + ' | PASS (score: ' + (cell.score||0).toFixed(1) + ')';
        break;
      case 'fail':
        cls = 'log-fail';
        msg = cell.taskId + ' | ' + cell.model + ' | FAIL';
        if (cell.testsPassed !== undefined) msg += ' (tests: ' + cell.testsPassed + '/' + cell.testsTotal + ')';
        break;
      case 'compile-error':
        cls = 'log-fail';
        msg = cell.taskId + ' | ' + cell.model + ' | COMPILE ERROR';
        break;
      case 'error':
        cls = 'log-fail';
        msg = cell.taskId + ' | ' + cell.model + ' | ERROR';
        break;
      default:
        return; // Don't log pending
    }

    logEntries.unshift({ time, cls, msg });
    if (logEntries.length > MAX_LOG) logEntries.pop();

    const container = $('log-container');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = '<span class="log-time">' + time + '</span><span class="' + cls + '">' + esc(msg) + '</span>';
    container.insertBefore(entry, container.firstChild);

    // Trim old entries from DOM
    while (container.children.length > MAX_LOG) {
      container.removeChild(container.lastChild);
    }
  }

  // ==================== Elapsed Timer ====================

  function startElapsedTimer() {
    setInterval(() => {
      if (!state || !state.progress) return;
      const elapsed = Date.now() - state.progress.startTime;
      $('progress-elapsed').textContent = formatDuration(elapsed);
    }, 1000);
  }

  // ==================== Utilities ====================

  function formatDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    if (totalSec < 60) return totalSec + 's';
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min < 60) return min + 'm ' + sec + 's';
    const hr = Math.floor(min / 60);
    return hr + 'h ' + (min % 60) + 'm';
  }

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function setupThemeToggle() {
    const toggle = $('theme-toggle');
    const icon = $('theme-icon');
    const label = $('theme-label');

    function setTheme(dark) {
      document.body.classList.toggle('dark', dark);
      icon.innerHTML = dark ? '&#9788;' : '&#9790;';
      label.textContent = dark ? 'Light' : 'Dark';
      localStorage.setItem('cg-dash-theme', dark ? 'dark' : 'light');
    }

    const saved = localStorage.getItem('cg-dash-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(saved === 'dark' || (!saved && prefersDark));

    toggle.addEventListener('click', () => {
      setTheme(!document.body.classList.contains('dark'));
    });
  }

  // Boot
  init();
})();
`;
