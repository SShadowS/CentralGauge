# CG-AL-X044 - reference solution (authoring probe)

Copied verbatim from `scratch/trap-probe/x044-correct/`, the correct side of the
task's discrimination probe. `.superpowers/sdd/task-x044-report.md` records it
passing 3/3 on Cronus28 at BC 28.0.46665.50383 while two no-subscriber
variants failed with the exact assertion shape the bench sees
(`AttachmentIsScopedToOwningRecord` Expected 0 Actual 1,
`MultipleRecordsStayIndependentlyScoped` Expected 2 Actual 3).

Containers have since moved to 28.4; re-probe before trusting it:

```
deno run -A scripts/trap-probe.ts --task CG-AL-X044 \
  --solution reference/solutions/CG-AL-X044 --expect pass
```

- mechanism: `OnAfterTableHasNumberFieldPrimaryKey` subscriber on
  `Codeunit "Document Attachment Mgmt"` registering table 69950 with `FieldNo := 1`
- committed 2026-09-05 from the 2026-09-05 audit (audit13/g5-report.md)
