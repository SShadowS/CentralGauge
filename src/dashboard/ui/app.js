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
  /** The `dir` actually sent to `/api/run` for the current `run` — captured
   *  when the request was made, not re-derived from `selectedDir` at promote
   *  time. The author can change the draft selector after a run completes,
   *  and re-deriving would then promote into the WRONG directory (the same
   *  dir-vs-id lesson `/api/run`'s own validation is built around). `null`
   *  until a run completes. */
  runDraftDir: null,
  /** The response currently shown in the detail panel, or `null` when the
   *  panel is showing something that is not a per-(model, object) cell (the
   *  "prompt sent" view). Backs "Use as wrong answer": the action promotes a
   *  RESPONSE's whole code, not whichever single object's source happens to
   *  be on screen, so it is keyed off this rather than off the row. */
  detailResponse: null,
  /** Escalation (spec §6/§9): per-model latest `VerifyOutcome` pushed over
   *  `/api/verify-events`, keyed by `response.model` — every event names its
   *  own column directly, so there is no job-id-to-model lookup to keep in
   *  sync. `blockedReason` is set when the most recent `POST /api/verify`
   *  was refused before any job was created (a live bench, or escalation
   *  not configured); both "Compile & test" actions render disabled with
   *  this text until a later attempt succeeds. `source` is the live
   *  `EventSource`, opened lazily — see `ensureVerifyEvents`.
   *
   *  `acceptedIds` holds the job ids THIS run asked for, as returned by
   *  `POST /api/verify`. The server's SSE replay is deliberately
   *  unfiltered — it replays every job the server process has ever
   *  accepted, across every draft and every run — so without this set an
   *  outcome from an earlier run, or from a different draft entirely, is
   *  written into a column of the run now on screen. Since the outcome map
   *  is keyed by model alone, that lands a real verdict (often "Passed
   *  first try") on a response that was never compiled. Reset alongside
   *  `outcomes` on every new run; see `handleVerifyEvent`. */
  verify: {
    outcomes: {},
    acceptedIds: new Set(),
    blockedReason: null,
    source: null,
  },
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
  container.appendChild(buildVerifyAllAction(run));
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

/**
 * A `vscode://file/...` deep link for an absolute path (spec §1). Backslashes
 * become forward slashes and the whole path is then URL-encoded, so a space
 * in a draft's path — a username, a copied-in directory name — does not
 * silently produce a link that looks fine and simply never opens.
 * `encodeURI` (not `encodeURIComponent`) is deliberate: it leaves `/` and
 * the drive letter's `:` alone while still escaping unsafe characters like
 * a space, so the path's structure survives in the resulting URL.
 */
function vscodeFileLink(absolutePath) {
  return `vscode://file/${encodeURI(absolutePath.replace(/\\/g, "/"))}`;
}

/**
 * One "Files" rail row that jumps into VS Code at `relativePath`, joined
 * onto `draft.dir` — the absolute path `listDrafts` (drafts.ts) already
 * resolved server-side, never re-derived here. Plain, unlinked text when
 * `draft` or `draft.dir` is unknown (the pre-selection "no drafts" render),
 * so that render stays exactly as it was before this row could be a link.
 */
function fileLinkItem(draft, relativePath, label, className) {
  if (!draft || !draft.dir) {
    return el("li", className, label);
  }
  const li = el("li", className);
  const link = el("a", "file-link", label);
  link.href = vscodeFileLink(`${draft.dir}\\${relativePath}`);
  li.appendChild(link);
  return li;
}

/**
 * The in-cell badge for a genuine id-or-name conflict between `row`'s
 * identity and the object this response actually assigned to it — spec §3:
 * two objects that normalize to the same row (object-identity.ts's
 * `buildRowUniverse`/`assignObjectsToRows`, via `nameFallbackKey`) merge into
 * ONE row, never two, but the field the merge did NOT decide on (id when
 * merged by name, name when merged by id) can still disagree, and that
 * disagreement is shown here, in-cell, never as a second row.
 *
 * This function performs NO comparison, id or name, raw or normalized. It
 * renders `response.rowIdentityConflicts[row.key]` — a server-computed
 * `RowIdentityConflict` (run-manager.ts) that is present ONLY when the
 * conflict is real, i.e. the ids genuinely differ, or the NORMALIZED names
 * genuinely differ (`normalizeName`, object-identity.ts). This file cannot
 * hold that logic itself: it is a classic script, so `import` is as illegal
 * here as the `export` this file's header comment already rules out, and
 * this file's own history is why the rule is never re-derived here either —
 * it used to carry copies of `normalizeName`/`objectKey` with nothing able
 * to notice when they drifted from the original, which is exactly what
 * `rowAssignments` being server-computed already fixed for cell placement.
 * Returns `null` when the server sent no entry for this row, e.g. an exact
 * match on both fields, or two names that differ only by case or whitespace.
 */
function buildMismatchBadge(row, response) {
  const conflicts = response.rowIdentityConflicts;
  const conflict = conflicts && conflicts[row.key];
  if (!conflict) return null;

  // `kind`/`extendsTarget` are never part of a conflict (see the type's own
  // doc comment: both are part of the row's identity key, so they can never
  // disagree), so they come from `row` here — only id/name are per-side.
  const expected = {
    kind: row.kind,
    id: conflict.expectedId,
    name: conflict.expectedName,
    extendsTarget: row.extendsTarget,
  };
  const actual = {
    kind: row.kind,
    id: conflict.actualId,
    name: conflict.actualName,
    extendsTarget: row.extendsTarget,
  };

  const badge = el("div", "mismatch-badge");
  badge.appendChild(
    el("span", "mismatch-expected", `Asked for: ${describeRow(expected)}`),
  );
  badge.appendChild(
    el("span", "mismatch-actual", `Wrote: ${describeRow(actual)}`),
  );
  return badge;
}

/**
 * The "Use as wrong answer" (naive/) action, spec §8. `index.html` carries no
 * markup for it — the detail panel it lives in is a fixed section, but this
 * action is built once, here, and appended into it, so it persists across
 * `showDetail` calls instead of accumulating a fresh copy (and a fresh click
 * listener) on every one.
 */
let promoteAction = null;

function ensurePromoteAction() {
  if (promoteAction) return promoteAction;

  const wrapper = el("div", "detail-promote-action");
  const button = el("button", null, "Use as wrong answer (naive/)");
  button.type = "button";
  button.addEventListener("click", () => promoteCurrentResponse());
  const status = el("p", "detail-promote-status");

  wrapper.appendChild(button);
  wrapper.appendChild(status);
  document.getElementById("detail-panel").appendChild(wrapper);

  promoteAction = { wrapper, button, status };
  return promoteAction;
}

/** Spec §8: "disabled when nothing extractable was produced" — the same
 *  condition `promoteAsNaive` itself refuses on first (Task 8's "Nothing
 *  extractable was produced" refusal), read here off the same `objects`
 *  array the server already parsed rather than re-deriving it. */
function hasPromotableCode(response) {
  return Array.isArray(response.objects) && response.objects.length > 0;
}

/** Re-syncs the promote action to `state.detailResponse` on every
 *  `showDetail` call: shown only for a per-(model, object) cell (not the
 *  column header's "prompt sent" view, which passes no response), enabled
 *  only when that response actually produced extractable AL. */
function updatePromoteAction() {
  const action = ensurePromoteAction();
  const response = state.detailResponse;

  if (!response) {
    action.wrapper.hidden = true;
    return;
  }

  action.wrapper.hidden = false;
  const canPromote = hasPromotableCode(response);
  action.button.disabled = !canPromote;
  action.button.title = canPromote
    ? "Write this response's AL into naive/, replacing what is there now"
    : "This response produced no extractable AL code";
  action.status.textContent = "";
  action.status.className = "detail-promote-status";
}

/**
 * POSTs the response shown in the detail panel to `/api/promote-naive`.
 * `code` is `resolution.cleanedCode` — never `rawResponse` — matching
 * `promoteAsNaive`'s own doc ("resolveCandidate's cleanedCode — never the
 * raw response"). `draftDir` comes from `state.runDraftDir`, the directory
 * the CURRENT run actually asked, not from re-reading the draft selector.
 *
 * A 400 covers both a validation failure and a `PromoteRefusal` — either way
 * `body.error` is shown verbatim, unmodified: per spec §8 and the brief this
 * feature exists to build against, the refusal message IS the point, not a
 * generic "failed".
 */
async function promoteCurrentResponse() {
  const action = ensurePromoteAction();
  const response = state.detailResponse;
  const draftDir = state.runDraftDir;
  if (!response || !draftDir) return;

  action.button.disabled = true;
  action.status.className = "detail-promote-status";
  action.status.textContent = "Promoting…";

  try {
    const res = await fetch("/api/promote-naive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draftDir,
        code: response.resolution.cleanedCode,
        model: response.model,
        attempt: 1,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(
        body.error ||
          `POST /api/promote-naive failed with status ${res.status}`,
      );
    }
    const removed = body.removed || [];
    const removedNote = removed.length > 0
      ? ` (replaced ${removed.length} existing file${
        removed.length === 1 ? "" : "s"
      })`
      : "";
    action.status.textContent = `Wrote to naive/: ${
      (body.written || []).join(", ")
    }${removedNote}`;
  } catch (error) {
    action.status.className = "detail-promote-status diagnostic-error";
    action.status.textContent = error.message;
  } finally {
    action.button.disabled = !hasPromotableCode(response);
  }
}

function showDetail(title, source, response) {
  const panel = document.getElementById("detail-panel");
  document.getElementById("detail-title").textContent = title;
  document.getElementById("detail-source").textContent = source;
  state.detailResponse = response || null;
  updatePromoteAction();
  panel.hidden = false;
}

function hideDetail() {
  document.getElementById("detail-panel").hidden = true;
}

/**
 * Escalation vocabulary (spec §6), plus the wording chosen here for the
 * three states the spec's table did not anticipate — Task 1's
 * `VerifyOutcome` widened past what section 6 enumerated. Centralising the
 * mapping is what makes `passed_second_try` swapping labels with
 * `passed_first_try` a one-line, one-test mutation instead of a silent
 * divergence between whichever render sites happened to spell it out
 * inline.
 *
 * `running`'s `phase` is deliberately never read here: it is frozen at
 * `"staging"` for the whole verify call (Task 4/5's `handleAlVerify` does
 * not report progress mid-call), so displaying it would assert compilation
 * or testing is under way before either has actually started — a specific,
 * wrong claim. The queue only knows the job started; that is all this says.
 */
function verifyOutcomeLabel(outcome) {
  switch (outcome.state) {
    case "queued":
      return { text: "Queued to compile & test", cls: "verify-queued" };
    case "running":
      return { text: "In progress…", cls: "verify-running" };
    case "passed_first_try":
      return { text: "Passed first try", cls: "verify-pass" };
    case "passed_second_try":
      return { text: "Passed on 2nd try", cls: "verify-pass" };
    case "failed_both":
      return {
        text: `Failed both tries (${outcome.passed} of ${outcome.total} tests)`,
        cls: "verify-fail",
      };
    case "didnt_compile":
      return { text: "Didn't compile", cls: "verify-fail" };
    // Not in spec §6. `publish_defect` is a candidate that published or
    // installed badly and ran ZERO tests — its pass/fail numbers are a
    // scoring convention, not a measurement. Reusing "Failed both tries"
    // would report a test result that never happened, so this names the
    // real cause instead, verbatim from the outcome's own `message`.
    case "publish_defect":
      return {
        text: `Didn't publish: ${outcome.message}`,
        cls: "verify-infra",
      };
    // The gate's reason, verbatim — no added wording, so what renders here
    // is exactly what `checkBenchGate`/the queue's own gate decided.
    case "refused":
      return { text: outcome.reason, cls: "verify-refused" };
    // Not in spec §6. A genuine infrastructure failure — a thrown verify
    // call, a dead container — with a real message. Must never render like
    // a test result: no counts, worded as an error rather than a pass/fail
    // label.
    case "errored":
      return {
        text: `Verification error: ${outcome.message}`,
        cls: "verify-error",
      };
    default:
      return { text: String(outcome.state), cls: "verify-unknown" };
  }
}

function isVerifyInFlight(outcome) {
  return Boolean(outcome) &&
    (outcome.state === "queued" || outcome.state === "running");
}

/**
 * The per-response "Compile & test" control (spec §6), plus whatever this
 * response's latest escalation outcome is. Built fresh on every
 * `buildColumnHeader` call, same as every other piece of the column, so a
 * live `/api/verify-events` push just needs to re-render — no separate
 * patch path to keep in sync with the initial render.
 */
function buildVerifyAction(response) {
  const wrapper = el("div", "verify-action");
  const outcome = state.verify.outcomes[response.model];
  const inFlight = isVerifyInFlight(outcome);
  const blocked = state.verify.blockedReason;

  const button = el("button", "verify-button", "Compile & test");
  button.type = "button";
  button.disabled = Boolean(blocked) || inFlight;
  button.title = blocked
    ? blocked
    : inFlight
    ? "Already compiling & testing"
    : "Publish this response to the container and run its tests";
  button.addEventListener("click", () => verifyOne(response));
  wrapper.appendChild(button);

  if (blocked) {
    wrapper.appendChild(el("p", "verify-blocked diagnostic-error", blocked));
  }

  if (outcome) {
    const mapped = verifyOutcomeLabel(outcome);
    wrapper.appendChild(
      el("div", `verify-status ${mapped.cls}`, mapped.text),
    );
  }

  return wrapper;
}

/**
 * "Compile & test all" (spec §6), scoped to every ready response in the
 * CURRENT run. `index.html` carries no markup for it — same reasoning as
 * `ensurePromoteAction`'s doc comment — but unlike that action this one is
 * rebuilt fresh on every call rather than kept as a singleton:
 * `renderTrapSummary` already runs on every new run and every escalation
 * update, and this button needs no state that outlives those calls beyond
 * what `state.verify` already holds.
 */
function buildVerifyAllAction(run) {
  const wrapper = el("div", "verify-all-action");
  const ready = (run.responses || []).filter((r) =>
    r.resolution && r.resolution.isReadyForCompile
  );
  const blocked = state.verify.blockedReason;

  const button = el("button", "verify-all-button", "Compile & test all");
  button.type = "button";
  button.disabled = Boolean(blocked) || ready.length === 0;
  button.title = blocked
    ? blocked
    : ready.length === 0
    ? "No response produced usable AL to compile"
    : `Compile & test ${ready.length} response${ready.length === 1 ? "" : "s"}`;
  button.addEventListener("click", () => verifyAll());
  wrapper.appendChild(button);

  if (blocked) {
    wrapper.appendChild(el("p", "verify-blocked diagnostic-error", blocked));
  }

  return wrapper;
}

/**
 * Applies one `/api/verify-events` payload to `state.verify.outcomes`.
 *
 * Every event that survives is written under `payload.job.model` — an event
 * names its own column directly (Task 7), so there is no job-id-to-model
 * lookup to maintain. But the model name alone does NOT identify a run.
 * `GET /api/verify-events` replays every job this server process has ever
 * accepted, unfiltered and by design, so a plain model-keyed write accepts:
 *
 * - a terminal outcome from a DIFFERENT draft, after the author switches
 *   drafts and clicks "Compile & test" (the stream opens, the replay lands,
 *   and the old draft's verdicts fill the new draft's columns); and
 * - a terminal outcome from an EARLIER batch on the same draft, when the
 *   author re-runs the models and clicks again.
 *
 * Either way the author is shown a test result — "Passed first try" among
 * them — for a response that was never compiled. So an event is applied
 * only when its own `payload.id` is one THIS run asked for. `runQuick`
 * empties `acceptedIds` with `outcomes`, and `submitVerify` fills it from
 * the ids `POST /api/verify` hands back. Filtering on
 * `payload.job.draftDir` instead would fix the cross-draft case and leave
 * the same-draft re-run case standing.
 *
 * Exported to the test harness (`loadUi`) rather than left inline in the
 * `onmessage` closure: this is the side that decides WHICH column an
 * outcome is written to, and it had no coverage at all.
 */
function handleVerifyEvent(payload) {
  if (!state.verify.acceptedIds.has(payload.id)) return;
  state.verify.outcomes[payload.job.model] = payload.outcome;
  refreshVerifyDisplay();
}

/**
 * Escalation's live stream (Task 7). Opened lazily on the first verify
 * request rather than at page load, so a session that never touches
 * "Compile & test" never holds a connection open. Idempotent — a later call
 * once `state.verify.source` is set is a no-op.
 */
function ensureVerifyEvents() {
  if (state.verify.source) return;
  if (typeof EventSource === "undefined") return;
  const source = new EventSource("/api/verify-events");
  source.onmessage = (event) => {
    handleVerifyEvent(JSON.parse(event.data));
  };
  state.verify.source = source;
}

/**
 * Re-renders whatever is currently on screen that reads `state.verify` —
 * the matrix's column headers and the "Compile & test all" action — after
 * either a live SSE push or a `POST /api/verify` response changes it. Full
 * rebuild, the same idiom `renderMatrix`/`renderTrapSummary` already use
 * everywhere else in this file; the matrix is small enough that this costs
 * nothing worth optimising around.
 */
function refreshVerifyDisplay() {
  if (!state.run) return;
  renderTrapSummary(state.run);
  renderMatrix(state.run);
}

/**
 * POSTs one or more responses to `/api/verify`. A non-2xx response sets
 * `state.verify.blockedReason` so both "Compile & test" actions render
 * disabled with the reason visible instead of silently doing nothing — 409
 * (a bench is live) and 501 (escalation not configured) are the two the
 * gate can refuse with, but any other failure is treated the same way. A
 * 200 clears it: the gate was open a moment ago, so stale blocked text must
 * not linger over a run that just started fine.
 */
async function submitVerify(responses) {
  const draftDir = state.runDraftDir;
  if (!draftDir || responses.length === 0) return;

  try {
    const res = await fetch("/api/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftDir, responses }),
    });
    const body = await res.json();
    if (!res.ok) {
      state.verify.blockedReason = body.error ||
        `POST /api/verify failed with status ${res.status}`;
      refreshVerifyDisplay();
      return;
    }
    state.verify.blockedReason = null;
    for (const { model, id } of body.jobs) {
      // Recorded BEFORE the stream is opened, so the replay that arrives
      // the moment it opens already knows which ids belong to this run.
      state.verify.acceptedIds.add(id);
      state.verify.outcomes[model] = { state: "queued" };
    }
    ensureVerifyEvents();
    refreshVerifyDisplay();
  } catch (error) {
    state.verify.blockedReason = error.message;
    refreshVerifyDisplay();
  }
}

function verifyOne(response) {
  return submitVerify([{
    model: response.model,
    code: response.resolution.cleanedCode,
  }]);
}

function verifyAll() {
  if (!state.run) return;
  const responses = state.run.responses
    .filter((r) => r.resolution.isReadyForCompile)
    .map((r) => ({ model: r.model, code: r.resolution.cleanedCode }));
  return submitVerify(responses);
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

  frag.appendChild(buildVerifyAction(response));

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
        response,
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
        response,
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
        response,
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

  const mismatchBadge = buildMismatchBadge(row, response);
  if (mismatchBadge) {
    wrapper.classList.add("cell-mismatch");
    wrapper.appendChild(mismatchBadge);
  }

  wrapper.addEventListener("click", () => {
    selectModelForRail(response.model);
    showDetail(`${response.model} — ${describeRow(row)}`, obj.source, response);
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
  list.appendChild(fileLinkItem(draft, "task.yml", "task.yml"));
  list.appendChild(
    draft && draft.id
      ? fileLinkItem(
        draft,
        `correct\\${draft.id}.Test.al`,
        "Test (oracle)",
      )
      : el("li", null, "Test (oracle)"),
  );
  list.appendChild(fileLinkItem(draft, "correct", "Right answer (correct/)"));
  list.appendChild(fileLinkItem(draft, "naive", "Wrong answer (naive/)"));

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
        list.appendChild(
          fileLinkItem(draft, `prereq\\${name}`, name, "file-list-nested"),
        );
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
    // The directory this run actually asked, captured now rather than
    // re-read from `selectedDir` later — see the `state.runDraftDir` doc
    // comment for why "Use as wrong answer" depends on this being the
    // request's own `draftDir`, not whatever the selector shows later.
    state.runDraftDir = draft.dir;
    // A new run means new response objects. Any escalation outcome kept
    // from a PRIOR run, keyed by model, would otherwise go on describing
    // code this run's column no longer holds if the same model is asked
    // again. Clearing the map alone is not enough: the server replays every
    // job it has ever accepted, so the prior run's outcomes would simply be
    // written back in. The accepted-id set is what keeps them out — see
    // `handleVerifyEvent`.
    state.verify.outcomes = {};
    state.verify.acceptedIds = new Set();
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
