"use strict";

/**
 * The matrix UI's client script. Plain browser JS, no build step, no
 * framework — served as-is by src/dashboard/server.ts.
 *
 * Object identity (`normalizeName`/`objectKey`) mirrors
 * src/al/object-identity.ts exactly, because a MatrixRow's `key` was
 * computed server-side by that module and this file has to re-derive the
 * same key for each response's own AL objects to know which one (if any)
 * fills a given cell. Keep the two in sync if the server-side rules change.
 */

const state = {
  drafts: [],
  selectedDir: null,
  run: null,
};

function normalizeName(name) {
  let text = name;
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1);
  }
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function objectKey(obj) {
  const parts = [obj.kind];
  if (obj.id !== undefined && obj.id !== null) {
    parts.push(String(obj.id));
  } else {
    parts.push("name:" + normalizeName(obj.name));
  }
  if (obj.extendsTarget !== undefined && obj.extendsTarget !== null) {
    parts.push(normalizeName(obj.extendsTarget));
  }
  return parts.join("|");
}

function nameFallbackKey(obj) {
  const parts = [obj.kind, normalizeName(obj.name)];
  if (obj.extendsTarget !== undefined && obj.extendsTarget !== null) {
    parts.push(normalizeName(obj.extendsTarget));
  }
  return parts.join("|");
}

/**
 * Finds the AL object (if any) in `objects` that fills `row`. Matches by
 * exact key first, then falls back to kind + normalized name (+ extends
 * target) — the same two-step rule buildRowUniverse uses server-side, so a
 * response that named the same object under a slightly different id still
 * lands on the right row instead of reading as "not written".
 */
function findObjectForRow(row, objects) {
  for (const obj of objects) {
    if (objectKey(obj) === row.key) return obj;
  }
  const rowKey = nameFallbackKey(row);
  for (const obj of objects) {
    if (nameFallbackKey(obj) === rowKey) return obj;
  }
  return undefined;
}

function verdictLabel(verdict) {
  switch (verdict) {
    case "made-the-mistake":
      return "Made the mistake";
    case "avoided-the-mistake":
      return "Avoided the mistake";
    case "different-approach":
      return "Different approach";
    case "cannot-compare":
      return "Couldn't compare yet";
    default:
      return verdict;
  }
}

function verdictClass(verdict) {
  switch (verdict) {
    case "made-the-mistake":
      return "verdict-bad";
    case "avoided-the-mistake":
      return "verdict-good";
    case "different-approach":
      return "verdict-neutral";
    default:
      return "verdict-unknown";
  }
}

function describeRow(row) {
  const idPart = row.id !== undefined && row.id !== null ? ` ${row.id}` : "";
  const extendsPart = row.extendsTarget ? ` extends ${row.extendsTarget}` : "";
  return `${row.kind}${idPart} "${row.name}"${extendsPart}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showDetail(title, source) {
  const panel = document.getElementById("detail-panel");
  document.getElementById("detail-title").textContent = title;
  document.getElementById("detail-source").textContent = source;
  panel.hidden = false;
}

function hideDetail() {
  document.getElementById("detail-panel").hidden = true;
}

/** The column header for one model: name, then verdict or no-code state.
 *
 * The name is a button: it opens the exact prompt this model was sent,
 * rendered server-side from the draft's task.yml through the bench's own
 * attempt-1 path. An author calibrating a draft needs to read the question,
 * and prompt injections are provider-scoped, so two columns in one run can
 * legitimately hold different text. */
function buildColumnHeader(response) {
  const frag = document.createDocumentFragment();
  const name = el("button", "model-name", response.model);
  name.type = "button";
  name.title = "Show the prompt this model was sent";
  name.addEventListener("click", () => {
    showDetail(
      `${response.model} — prompt sent`,
      response.prompt || "(no prompt was rendered — see the error below)",
    );
  });
  frag.appendChild(name);

  if (!response.resolution.isReadyForCompile) {
    const pct = Math.round((response.resolution.confidence || 0) * 100);
    const diag = el(
      "div",
      "badge badge-no-code",
      `No usable AL — method: ${response.resolution.method}, confidence: ${pct}%`,
    );
    frag.appendChild(diag);
    if (response.resolution.failure && response.resolution.failure.error) {
      frag.appendChild(
        el("div", "diagnostic-error", response.resolution.failure.error),
      );
    }
    return frag;
  }

  const verdict = response.classification
    ? response.classification.verdict
    : undefined;
  frag.appendChild(
    el("div", `badge ${verdictClass(verdict)}`, verdictLabel(verdict)),
  );

  if (response.error) {
    frag.appendChild(el("div", "diagnostic-error", response.error));
  }

  return frag;
}

/** One (row, model) cell. Every cell is clickable and never throws, even
 * for an object a model never wrote. */
function buildCell(row, response) {
  const wrapper = el("div", "cell");
  wrapper.tabIndex = 0;

  if (!response.resolution.isReadyForCompile) {
    wrapper.classList.add("cell-empty");
    wrapper.textContent = "–";
    wrapper.addEventListener("click", () => {
      const reason =
        response.resolution.failure && response.resolution.failure.error
          ? response.resolution.failure.error
          : `extraction method: ${response.resolution.method}`;
      showDetail(
        `${response.model} — ${describeRow(row)}`,
        `${response.model} produced no usable AL (${reason}).`,
      );
    });
    return wrapper;
  }

  const obj = findObjectForRow(row, response.objects);

  if (!obj) {
    wrapper.classList.add("cell-absent");
    wrapper.textContent = "not written";
    wrapper.addEventListener("click", () => {
      showDetail(
        `${response.model} — ${describeRow(row)}`,
        `${response.model} did not write this object.`,
      );
    });
    return wrapper;
  }

  const isExtra = !row.inReference;
  if (isExtra) {
    wrapper.classList.add("cell-extra");
    wrapper.appendChild(el("span", "extra-label", "Wrote extra object"));
  } else {
    wrapper.classList.add("cell-present");
    wrapper.textContent = "view source";
  }

  wrapper.addEventListener("click", () => {
    showDetail(`${response.model} — ${describeRow(row)}`, obj.source);
  });

  return wrapper;
}

function renderMatrix(run) {
  const container = document.getElementById("matrix-container");
  container.innerHTML = "";

  if (run.rows.length === 0) {
    container.appendChild(
      el(
        "p",
        "empty-state",
        "No objects found — nothing in the reference solution and no response produced any.",
      ),
    );
    return;
  }

  const table = el("table", "matrix");
  const thead = el("thead");
  const headRow = el("tr");
  headRow.appendChild(el("th", null, "Object"));
  for (const response of run.responses) {
    const th = el("th");
    th.appendChild(buildColumnHeader(response));
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el("tbody");
  for (const row of run.rows) {
    const tr = el("tr");
    const rowHeader = el("th", null, describeRow(row));
    rowHeader.scope = "row";
    tr.appendChild(rowHeader);

    for (const response of run.responses) {
      const td = el("td");
      td.appendChild(buildCell(row, response));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  container.appendChild(table);
}

function renderFileList(draft) {
  const list = document.getElementById("file-list");
  list.innerHTML = "";
  const items = [
    "task.yml",
    "Test (oracle)",
    "Right answer (correct/)",
    "Wrong answer (naive/)",
  ];
  for (const item of items) {
    list.appendChild(el("li", null, item));
  }

  if (draft && draft.hasPrereq) {
    const heading = el("li", "file-list-heading", "Already exists (prereq)");
    list.appendChild(heading);

    const files = draft.prereqFiles || [];
    if (files.length === 0) {
      list.appendChild(el("li", "file-list-nested empty-state", "(empty)"));
    } else {
      for (const name of files) {
        list.appendChild(el("li", "file-list-nested", name));
      }
    }
  }
}

function draftLabel(draft) {
  return `${draft.id} — ${draft.dirName}`;
}

function renderDraftOptions() {
  const select = document.getElementById("draft-select");
  select.innerHTML = "";

  if (state.drafts.length === 0) {
    select.appendChild(el("option", null, "No drafts found in scratch/"));
    select.disabled = true;
    renderFileList(undefined);
    return;
  }

  select.disabled = false;
  for (const draft of state.drafts) {
    const option = el("option", null, draftLabel(draft));
    // `dir` is the only field guaranteed unique across drafts — `id` alone
    // can collide across two directories, so the select's value (and the
    // draftId sent to /api/run) is keyed on `dir`, then resolved back to
    // the matching draft's `id` at run time.
    option.value = draft.dir;
    select.appendChild(option);
  }
  state.selectedDir = state.drafts[0].dir;
  select.value = state.selectedDir;
  renderFileList(state.drafts[0]);
}

function selectedDraft() {
  return state.drafts.find((d) => d.dir === state.selectedDir);
}

function parseModelList(raw) {
  return raw
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
}

function updateRunButton() {
  const button = document.getElementById("run-button");
  const models = parseModelList(document.getElementById("model-input").value);
  const hasDraft = Boolean(selectedDraft());

  if (!hasDraft || models.length === 0) {
    button.disabled = true;
    button.textContent = "Ask models";
    return;
  }

  button.disabled = false;
  button.textContent = models.length === 1
    ? "Ask 1 model"
    : `Ask ${models.length} models`;
}

/**
 * Pre-fills the model input from the CLI's `--preset` resolution
 * (`GET /api/defaults`, wired by `cli/commands/workbench-command.ts`).
 * Best-effort only: an empty list (no `--preset` given, an unknown name, or
 * a fetch failure) leaves the field exactly as `loadDrafts` requires anyway
 * — empty and ready for the author to type slugs into by hand.
 */
async function loadDefaultModels() {
  try {
    const res = await fetch("/api/defaults");
    if (!res.ok) return;
    const body = await res.json();
    const models = Array.isArray(body.defaultModels) ? body.defaultModels : [];
    if (models.length === 0) return;
    document.getElementById("model-input").value = models.join(", ");
    updateRunButton();
  } catch {
    // Silent — pre-fill is a convenience, not a requirement.
  }
}

async function loadDrafts() {
  const errorEl = document.getElementById("draft-error");
  errorEl.hidden = true;
  try {
    const res = await fetch("/api/drafts");
    if (!res.ok) {
      throw new Error(`GET /api/drafts failed with status ${res.status}`);
    }
    const body = await res.json();
    state.drafts = body.drafts || [];
    renderDraftOptions();
    updateRunButton();
  } catch (error) {
    state.drafts = [];
    renderDraftOptions();
    errorEl.textContent = `Could not load drafts: ${error.message}`;
    errorEl.hidden = false;
  }
}

async function runQuick() {
  const draft = selectedDraft();
  const models = parseModelList(document.getElementById("model-input").value);
  const statusEl = document.getElementById("run-status");
  const button = document.getElementById("run-button");

  if (!draft || models.length === 0) return;

  button.disabled = true;
  statusEl.textContent = `Asking ${
    models.length === 1 ? "1 model" : `${models.length} models`
  }…`;
  hideDetail();

  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId: draft.id, models }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(
        body.error || `POST /api/run failed with status ${res.status}`,
      );
    }
    state.run = body;
    renderMatrix(body);
    statusEl.textContent = `Last run: ${
      new Date(body.startedAt).toLocaleTimeString()
    }`;
  } catch (error) {
    statusEl.textContent = `Run failed: ${error.message}`;
  } finally {
    updateRunButton();
  }
}

function wireEvents() {
  document.getElementById("draft-select").addEventListener(
    "change",
    (event) => {
      state.selectedDir = event.target.value;
      renderFileList(selectedDraft());
      updateRunButton();
    },
  );

  document.getElementById("model-input").addEventListener(
    "input",
    updateRunButton,
  );

  document.getElementById("run-button").addEventListener("click", () => {
    runQuick();
  });

  document.getElementById("detail-close").addEventListener("click", hideDetail);
}

/**
 * A promise, not a per-run status: quick runs here never reach the public
 * scoreboard, regardless of what any individual run produces, so this is
 * rendered once at load time rather than recomputed after each run.
 */
function renderStandingNote() {
  document.getElementById("standing-note").textContent =
    "Never published to the scoreboard.";
}

function init() {
  renderStandingNote();
  wireEvents();
  loadDrafts();
  loadDefaultModels();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
