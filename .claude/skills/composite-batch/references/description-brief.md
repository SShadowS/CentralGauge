# Description brief for composite tasks (the lever)

This is the most load-bearing artifact in the composite pipeline. The apps are
assembled mechanically; what decides whether a composite resists is what the
description withholds. Hand this file, verbatim, to whoever writes the
descriptions.

## Why it matters, measured

The suite's pre-existing "triage" composites (X096-X100, X141-X145) are the
SAME shape and size as the ones that gate, and every one of them is solved
single-shot. The difference is one sentence. X096 says:

> The exchange-rate client, the shipment importer and the wire-format codec are
> all working correctly today and must not be changed. Only the order export
> module has problems, and two have appeared since the partner went live.

That tells the model which module, how many defects, and then enumerates both
symptoms. It converts attention dilution into a guided tour. X175, which does
resist, instead says the release "regressed the application in more than one of
these four areas at once, without the reports reliably pointing to any single
one of them". The 22 gated tasks withhold strictly more than X175 does.

## The shape

```
<One opening sentence naming what the application as a whole is.>
<For EACH module, one or two sentences: name the codeunit(s) and procedure(s)
 by exact quoted AL name, and state that module's CONTRACT - how it is supposed
 to behave - in plain business terms, present tense, neutral.>
<One closing vague symptom sentence.>
Fix the application so every contract above holds.
```

## Hard rules

1. NEVER state how many things are wrong. Not "two", "several", "more than
   one", "a defect". Numbers INSIDE a contract are fine ("two decimal places",
   "5,000 or more").
2. NEVER identify which module is affected, and NEVER say or imply that any
   module is correct, working, fine, or must not be changed.
3. NEVER name a mechanism. Banned: rounding, remainder, cache, commit,
   transaction, rollback, filter, key, index, event, subscriber, publisher,
   temporary, var parameter, alias, locale, culture, namespace, retry, status
   code, permission, lock, sequence, ordering, truncation, overflow, boundary,
   off-by-one. A quoted AL name containing such a word ("Deal Reference",
   "Setting Key", "Category Report Filter") is allowed - it names a domain
   field, not the mechanism.
4. NEVER describe the symptom of any INDIVIDUAL defect. The donor descriptions
   DO contain symptoms ("now the audit trail's snapshot keeps changing to match
   every later edit"). Strip every one; keep only the contract half.
5. Every contract sentence must read as a neutral statement of intended
   behaviour, equally true and equally natural if nothing at all were broken.
6. The closing symptom sentence is vague, business-voiced, and VARIED across a
   batch. Good: "Since the last release, figures this application produces have
   stopped agreeing with the records behind them, and what users report points
   nowhere in particular."
7. Exact AL names, quoted as they appear in the composite's own starter - not
   as the donor prose spells them.
8. No mention of benchmarks, composites, or modules assembled from anywhere.
9. Length: roughly 60-70 words per module. 180-320 words at four modules,
   320-560 at eight.

## The fairness rule, which is not optional

**Withholding where the bug is, is the experiment. Withholding what the
contract is, is an unfair task.**

State each contract PRECISELY - the exact threshold, value or format the oracle
grades - because a model cannot satisfy a loosely stated contract when nothing
points at where the problem is. Prefer "an away-time of exactly six hours earns
nothing, and anything longer earns the higher allowance" over "long trips earn
more". Read the merged oracle, not just the donor prose, and state what it
actually asserts.

This bit once: on X253 a writer dropped one clause of a contract for length and
the oracle graded that clause (`X116_NoInvoicesYieldEmptyText`). Nothing shipped
because X253 never became a candidate, but **diff every description against its
oracle's test names before screening.**

## Worked examples from tasks that gated

Contract sentence, X114 inside X185 - the defect is `>= 360` where the contract
says `> 360`, and the description states the boundary exactly without hinting
that it is the interesting one:

> Codeunit "CG X114 Allowance Calc" derives a travel allowance from a claim's
> away-time in minutes through CalculateAllowance, stores that amount onto the
> "CG X114 Travel Claim" record through RecalculateClaim, and classifies the
> same away-time into the bands the away-time statistics report uses through
> OvertimeBandOf. The amount a claim is paid and the band it is reported under
> describe the same outcome for any away-time.

Closing symptom, X185:

> Since the last release, figures this application hands over have stopped
> agreeing with the records they were built from, and nobody reporting it has
> been able to say where it starts.
