"use strict";

/**
 * The matrix UI's client script. Plain browser JS, no build step, no
 * framework — served as-is by src/dashboard/server.ts.
 *
 * This file does NOT compute object identity. It used to carry copies of
 * normalizeName/objectKey from src/al/object-identity.ts, with a comment
 * asking a future editor to keep them in sync and nothing able to notice
 * when they stopped being so. The server, which holds both the rows and
 * each response's objects, now answers the question directly: every
 * response arrives with `rowAssignments`, a row key -> object index map
 * (assignObjectsToRows).
 */

const state = {
  drafts: [],
  selectedDir: null,
  run: null,
  /** Which response's `prereqBinding` the "Already exists (prereq)" rail is
   *  scoped to. `null` until a run completes. */
  selectedModel: null,
};

/**
 * The AL object (if any) from `response` that fills `row`, read off the
 * server's own assignment. Index 0 is a legitimate answer, so this checks
 * for `undefined` rather than truthiness.
 */
function findObjectForRow(row, response) {
  const assignments = response.rowAssignments || {};
  const index = assignments[row.key];
  return index === undefined ? undefined : response.objects[index];
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

/**
 * Author-facing wording for TrapSignature.emptyReason. Every one of these
 * asks for a DIFFERENT action, which is the whole reason the discriminant
 * exists: "Couldn't compare yet" on its own cannot tell an author whether to
 * fix a malformed naive/ or to accept that the trap does not discriminate.
 */
function emptyReasonNote(reason) {
  switch (reason) {
    case "no-correct-objects":
      return "Nothing readable in correct/. Write the right answer, or check that what is there parses as AL.";
    case "no-naive-objects":
      return "Nothing readable in naive/. Write the wrong answer before asking models.";
    case "no-matching-objects":
      return "correct/ and naive/ have no object in common. Check the object ids and names line up.";
    case "no-matching-procedures":
      return "The shared object has no procedure or trigger in common. Check the member names line up.";
    case "divergence-outside-statements":
      return "The two sides vary only by a whole object or member, which this comparison cannot use. Give naive/ the same shape as correct/ and change a statement inside it.";
    case "no-divergence":
      return "correct/ and naive/ are the same, statement for statement. naive/ needs a real mistake in it.";
    default:
      return "No trap could be derived from this draft.";
  }
}

/** One trap site as a single line: where it is, and the two forms. */
function describeSite(site) {
  const parts = [`In ${site.procedureName}`];
  if (site.correctForm) parts.push(`right: ${site.correctForm}`);
  if (site.naiveForm) parts.push(`wrong: ${site.naiveForm}`);
  return parts.join(" — ");
}

const MAX_LISTED_SITES = 3;

/**
 * The trap this run was judged against, named above the grid. Spec §4 lists
 * explainability as one of three reasons the structural classifier is worth
 * its cost: the UI names the deciding statement rather than showing a score.
 */
function renderTrapSummary(run) {
  const container = document.getElementById("trap-summary");
  container.innerHTML = "";
  const signature = run.signature;

  if (!signature) return;

  if (!signature.sites || signature.sites.length === 0) {
    container.appendChild(el("h2", "trap-heading", "Couldn't compare yet"));
    container.appendChild(
      el("p", "trap-reason", emptyReasonNote(signature.emptyReason)),
    );
    return;
  }

  const count = signature.sites.length;
  container.appendChild(
    el(
      "h2",
      "trap-heading",
      count === 1 ? "The trap: 1 statement" : `The trap: ${count} statements`,
    ),
  );
  const list = el("ul", "trap-sites");
  for (const site of signature.sites.slice(0, MAX_LISTED_SITES)) {
    list.appendChild(el("li", null, describeSite(site)));
  }
  if (count > MAX_LISTED_SITES) {
    list.appendChild(
      el("li", "trap-more", `…and ${count - MAX_LISTED_SITES} more`),
    );
  }
  container.appendChild(list);
}

/** Where the run was saved, or why it was not. */
function renderArtifactNote(run) {
  const note = document.getElementById("artifact-note");
  if (run.artifactPath) {
    note.textContent = `Saved to ${run.artifactPath}`;
    note.className = "artifact-note";
  } else if (run.artifactError) {
    note.textContent = `Could not save this run: ${run.artifactError}`;
    note.className = "artifact-note artifact-note-failed";
  } else {
    note.textContent = "";
    note.className = "artifact-note";
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
    // `response.error` first when there is one. A model that threw is routed
    // through resolveCandidate("", "error"), so the derived string here is
    // always "Model returned empty response" — which reads as a refusal when
    // the truth may be a bad slug, a missing API key or a 401. The thrown
    // message is strictly better information, and this used to be appended
    // only in the branch below, which such a response can never reach.
    const detail = response.error ||
      (response.resolution.failure && response.resolution.failure.error);
    if (detail) {
      frag.appendChild(el("div", "diagnostic-error", detail));
    }
    return frag;
  }

  const verdict = response.classification
    ? response.classification.verdict
    : undefined;
  frag.appendChild(
    el("div", `badge ${verdictClass(verdict)}`, verdictLabel(verdict)),
  );

  // parseAlObjects yields zero objects for a syntax error ANYWHERE in the
  // candidate, so without saying so the row cells below would all read
  // "not written" for a model that plainly wrote the object — an ordinary
  // prose-wrapped answer lands here.
  if (response.hasParseError) {
    frag.appendChild(
      el("div", "badge badge-unparsed", "AL would not parse"),
    );
  }

  const site = response.classification && response.classification.decidingSite;
  if (site) {
    frag.appendChild(el("div", "deciding-site", describeSite(site)));
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
      selectModelForRail(response.model);
      // Same precedence as the column header: a thrown error outranks the
      // derived extraction string, which for a thrown error is always
      // "Model returned empty response".
      const reason = response.error ||
        (response.resolution.failure && response.resolution.failure.error) ||
        `extraction method: ${response.resolution.method}`;
      showDetail(
        `${response.model} — ${describeRow(row)}`,
        `${response.model} produced no usable AL (${reason}).`,
      );
    });
    return wrapper;
  }

  const obj = findObjectForRow(row, response);

  // Its own state, ahead of "not written": a parse failure means we do not
  // KNOW whether the object was written, and saying "not written" about a
  // response that contains the object is the lie this state exists to stop.
  if (!obj && response.hasParseError) {
    wrapper.classList.add("cell-unparsed");
    wrapper.textContent = "unreadable";
    wrapper.addEventListener("click", () => {
      selectModelForRail(response.model);
      showDetail(
        `${response.model} — ${describeRow(row)}`,
        `${response.model}'s answer could not be parsed as AL, so there is ` +
          `no per-object result for it. The raw answer is below.\n\n` +
          response.rawResponse,
      );
    });
    return wrapper;
  }

  if (!obj) {
    wrapper.classList.add("cell-absent");
    wrapper.textContent = "not written";
    wrapper.addEventListener("click", () => {
      selectModelForRail(response.model);
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
    selectModelForRail(response.model);
    showDetail(`${response.model} — ${describeRow(row)}`, obj.source);
  });

  return wrapper;
}

function renderMatrix(run) {
  const container = document.getElementById("matrix-container");
  container.innerHTML = "";

  if (run.rows.length === 0) {
    const unparsed = run.responses.filter((r) => r.hasParseError);
    container.appendChild(
      el(
        "p",
        "empty-state",
        unparsed.length > 0
          ? `No objects found — nothing in the reference solution, and ${
            unparsed.length === 1
              ? "the one response that answered"
              : `${unparsed.length} responses`
          } could not be parsed as AL.`
          : "No objects found — nothing in the reference solution and no response produced any.",
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

/** Author-facing label for a `hard`/`soft` prereq finding (spec §5/§6).
 *  `known` gets no label — showing one would read as doubt about a
 *  reference that is actually correct, the opposite of what the tiers exist
 *  to convey. */
function prereqTierLabel(tier) {
  if (tier === "hard") return "Made up this field";
  if (tier === "soft") return "Unknown member";
  return null;
}

/** hard, then soft, then known — so the actionable findings sit at the top
 *  of the rail instead of being buried under correct references. */
const PREREQ_TIER_ORDER = { hard: 0, soft: 1, known: 2 };

/**
 * The prereq rail (spec §5), scoped to one response's `prereqBinding`
 * (`bindResponseToPrereqs`, run-manager.ts). It shows WHICH prereq members
 * the response actually referenced, tiered by how confidently an unknown
 * one can be called invented — a `soft` finding rendered with the `hard`
 * label would be a false accusation against a model that wrote correct
 * code, so the two never share a class or a label, and `known` never gets
 * one at all.
 */
function renderPrereqRail(binding) {
  const frag = document.createDocumentFragment();

  if (binding.degraded) {
    frag.appendChild(
      el(
        "li",
        "file-list-nested prereq-degraded",
        "Couldn't check the prereq",
      ),
    );
    return frag;
  }

  const findings = binding.findings.slice().sort((a, b) =>
    PREREQ_TIER_ORDER[a.tier] - PREREQ_TIER_ORDER[b.tier]
  );

  if (findings.length === 0) {
    frag.appendChild(
      el(
        "li",
        "file-list-nested empty-state",
        "Nothing from prereq/ referenced",
      ),
    );
    return frag;
  }

  // table -> procedureName -> findings, insertion-ordered — since `findings`
  // is already tier-sorted, the first table/procedure to hold a `hard`
  // finding is also the first one inserted, so the grouping itself surfaces
  // actionable tables ahead of ones with only `soft`/`known` references.
  const byTable = new Map();
  for (const finding of findings) {
    let byProcedure = byTable.get(finding.table);
    if (!byProcedure) {
      byProcedure = new Map();
      byTable.set(finding.table, byProcedure);
    }
    let members = byProcedure.get(finding.procedureName);
    if (!members) {
      members = [];
      byProcedure.set(finding.procedureName, members);
    }
    members.push(finding);
  }

  for (const [table, byProcedure] of byTable) {
    const tableItem = el("li", "file-list-nested prereq-table", table);
    const procedureList = el("ul", "prereq-procedures");
    for (const [procedureName, members] of byProcedure) {
      const procedureItem = el("li", "prereq-procedure", procedureName);
      const memberList = el("ul", "prereq-members");
      for (const finding of members) {
        const label = prereqTierLabel(finding.tier);
        const memberItem = el(
          "li",
          `prereq-member prereq-tier-${finding.tier}`,
          `${finding.member} — line ${finding.line}`,
        );
        if (label) {
          memberItem.appendChild(el("span", "prereq-label", label));
        }
        memberList.appendChild(memberItem);
      }
      procedureItem.appendChild(memberList);
      procedureList.appendChild(procedureItem);
    }
    tableItem.appendChild(procedureList);
    frag.appendChild(tableItem);
  }

  return frag;
}

/**
 * The "Files" rail, including the "Already exists (prereq)" section.
 * `binding` is `undefined` before any run — the plain per-draft static
 * listing (`draft.prereqFiles`), untouched, heading unnamed. Once a run has
 * completed and a response's `prereqBinding` is passed in (`model` names
 * whose response it is — never left ambiguous, since a multi-model run
 * silently describing one response as if it were the whole run is the same
 * class of misinformation the tiers themselves exist to prevent):
 * `degraded` renders why analysis couldn't run, plus the static listing
 * beneath it (the spec's stated fallback); otherwise `renderPrereqRail`
 * replaces the static listing with what that response actually touched.
 */
function renderFileList(draft, binding, model) {
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
    const headingText = binding
      ? `Already exists (prereq) — as referenced by ${model}`
      : "Already exists (prereq)";
    const heading = el("li", "file-list-heading", headingText);
    list.appendChild(heading);

    if (binding) {
      list.appendChild(renderPrereqRail(binding));
      if (!binding.degraded) return;
    }

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

/**
 * Re-renders the "Files" rail for the current draft, scoped to
 * `state.selectedModel`'s `prereqBinding`. Centralised so a fresh run and
 * every cell click share one "find the response, read its binding" instead
 * of each copying it.
 */
function renderScopedFileList() {
  const draft = selectedDraft();
  if (!state.run) {
    renderFileList(draft);
    return;
  }
  const response = state.run.responses.find((r) =>
    r.model === state.selectedModel
  );
  renderFileList(
    draft,
    response && response.prereqBinding,
    state.selectedModel,
  );
}

/**
 * Scopes the prereq rail to `model`'s response. Wired to every cell click
 * (`buildCell`) so browsing a model's column — the same click an author
 * already makes to read that cell's detail — is what moves the rail onto
 * that model. Without this, a four-model run's rail would silently keep
 * describing whichever response happened to load first, with nothing on
 * screen saying so.
 */
function selectModelForRail(model) {
  state.selectedModel = model;
  renderScopedFileList();
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
    // can collide across two directories (a backup copy of a draft keeps the
    // task id in its task.yml). So the select's value AND the draftDir sent
    // to /api/run are both `dir`; `id` is display only.
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
      body: JSON.stringify({ draftDir: draft.dir, models }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(
        body.error || `POST /api/run failed with status ${res.status}`,
      );
    }
    state.run = body;
    // Defaults the rail to the first response (spec §5's "selected
    // response" before any selection has been made). Now labelled — via
    // renderScopedFileList/renderFileList — so this default is honest
    // rather than silently standing in for the whole run. A cell click
    // moves it via `selectModelForRail`.
    const firstResponse = body.responses[0];
    state.selectedModel = firstResponse && firstResponse.model;
    renderTrapSummary(body);
    renderMatrix(body);
    renderArtifactNote(body);
    renderScopedFileList();
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
