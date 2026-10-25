---
bc-version: [all]
domain: style
keywords: [var-record, by-reference, pass-by-value, record-parameter, page-action, re-fetch, stale-buffer, codeunit, modify]
technologies: [al]
countries: [w1]
application-area: [all]
---

# A new procedure that changes the page's current record should take it as `var Record`

## Description

AL passes parameters by value unless they are declared `var`, and a by-value `Record` parameter is a copy: changes the procedure makes "affect only the copy, not the variable itself" ([Working with AL methods](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/developer/devenv-al-methods#parameters)). Suppose a page/pageextension trigger hands a codeunit only a key (`Rec."No."`) or a by-value `Rec`, and the procedure `Get`s or modifies its own variable. The trigger's `Rec` then keeps the field values it had before the call. Any code later in the same trigger that reads `Rec` or writes from it works on stale data. Examples are a message, a `TestField`, or a follow-up assignment and `Modify`.

The page display is not the problem. After an action runs, the page refreshes its current record by itself, because `OnAfterGetRecord` runs (or `OnFindRecord` when the record left the filter) ([Actions at runtime](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/developer/devenv-actions-overview#actions-at-runtime)). The harm is confined to code that uses `Rec` after the call in the same trigger, or to a non-page caller that keeps holding the record.

## Best Practice

When you design a new procedure whose job is to change the record a page/pageextension trigger already holds, declare that record as `var Record` and mutate it in place. The procedure's `Modify` then updates the trigger's `Rec`. The Learn page above shows the same shape: `CurrPage.SetSelectionFilter(Rec); codeunit.Run(50000, Rec);`, through `Codeunit.Run(Number, var Record)`. Base Application's Sales Order Reopen action calls `ReleaseSalesDoc.PerformManualReopen(Rec)`, and `Reopen(var SalesHeader)` sets `Status` and calls `Modify(true)` on that parameter. A procedure that needs a locked read can call `LockTable`/`ReadIsolation` and `Find` on the `var` parameter. That refreshes the caller's buffer too.

A `var Record` parameter has a cost: the callee receives the page's live record, including its filters and current key. It must not change filters or keys on the parameter. If it needs its own filtering, it should copy the record or call `SetRecFilter` on a copy first.

Treat this as design guidance (`minor`). Do not change an already-shipped public procedure from by-value to `var` in place. Adding or removing `var` there is a breaking change (AppSourceCop [AS0078](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/developer/analyzers/appsourcecop-as0078); see `breaking-changes/do-not-change-published-procedure-signatures`). Add a new procedure instead. A `var Record` overload can sit beside a key-typed one, but an overload that differs only by `var` is rejected with [AL0440](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/developer/diagnostics/diagnostic-al440) (verified with AL compiler 30.0).

See sample: [`mutating-procedure-for-a-page-caller-takes-var-record.good.al`](mutating-procedure-for-a-page-caller-takes-var-record.good.al).

## Anti Pattern

All four of these must hold:
- A new codeunit procedure takes a key (`Code`, `Integer`, `Guid`) or a non-`var` `Record`.
- It `Get`s or uses its own copy and calls `Modify` on that same table's record.
- A page/pageextension trigger calls it with `Rec` or a key field of `Rec`.
- Later in the same trigger, code reads `Rec` fields the procedure changed, or writes from `Rec`.

A `Rec.Get` right after the call is context only, not evidence. Re-reading is a common, benign Base Application idiom, used even after `var` calls.

Do not flag these legitimate key-based or by-value shapes:
- Background and scheduled entry points. Job queue codeunits resolve `"Record ID to Process"`; `TaskScheduler.CreateTask` takes a `RecordId`; page background tasks pass text parameters.
- API page actions over a buffer or entity table that locate the real record by `SystemId`.
- Generic, table-agnostic APIs that take `RecordId`, `RecordRef`, or `Variant`, such as `Approvals Mgmt.ApproveRecordApprovalRequest(RecordId)`.
- Key-based procedures whose change happens inside a platform or System API.
- Procedures that change a different table or only read, and temporary records.
- A by-value record modified inside a `FindSet` loop, which `performance/avoid-cloning-records-before-modify-delete-in-loops` covers.
- In-place changes to published procedures, which the breaking-changes article above covers.

See also `style/pages-must-not-contain-business-logic` for where the mutation itself belongs.

See sample: [`mutating-procedure-for-a-page-caller-takes-var-record.bad.al`](mutating-procedure-for-a-page-caller-takes-var-record.bad.al).

## References

- [Working with AL methods, Parameters](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/developer/devenv-al-methods#parameters): by value is the default, and "a *copy of the variable* is passed to the method".
- [Actions overview, Actions at runtime](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/developer/devenv-actions-overview#actions-at-runtime): the page refresh after an action, and the `SetSelectionFilter` + `codeunit.Run(50000, Rec)` example. [Codeunit.Run](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/developer/methods-auto/codeunit/codeunit-run-method): `Codeunit.Run(Number: Integer [, var Record: Record])`.
- BCApps at [`837ef80`](https://github.com/microsoft/BCApps/tree/837ef802485ee457e52310d2ecaa08b93d0122fd), Base Application examples:
  - `var` idiom: [`SalesOrder.Page.al#L1610`](https://github.com/microsoft/BCApps/blob/837ef802485ee457e52310d2ecaa08b93d0122fd/src/Layers/W1/BaseApp/Sales/Document/SalesOrder.Page.al#L1610) and [`ReleaseSalesDocument.Codeunit.al#L223-L240`](https://github.com/microsoft/BCApps/blob/837ef802485ee457e52310d2ecaa08b93d0122fd/src/Layers/W1/BaseApp/Sales/Document/ReleaseSalesDocument.Codeunit.al#L223-L240).
  - Carve-outs: job queue [`SalesPostviaJobQueue.Codeunit.al#L20-L33`](https://github.com/microsoft/BCApps/blob/837ef802485ee457e52310d2ecaa08b93d0122fd/src/Layers/W1/BaseApp/Sales/Posting/SalesPostviaJobQueue.Codeunit.al#L20-L33); `RecordId` API [`ApprovalsMgmt.Codeunit.al#L251`](https://github.com/microsoft/BCApps/blob/837ef802485ee457e52310d2ecaa08b93d0122fd/src/Layers/W1/BaseApp/OtherCapabilities/Approvals/ApprovalsMgmt.Codeunit.al#L251); `SystemId` API action [`APIV2SalesOrders.Page.al#L797-L801`](https://github.com/microsoft/BCApps/blob/837ef802485ee457e52310d2ecaa08b93d0122fd/src/Apps/W1/APIV2/app/src/pages/APIV2SalesOrders.Page.al#L797-L801); System API [`SOAReplyRetryMgt.Codeunit.al#L27-L42`](https://github.com/microsoft/BCApps/blob/837ef802485ee457e52310d2ecaa08b93d0122fd/src/Apps/W1/SalesOrderAgent/app/src/Integration/SOAReplyRetryMgt.Codeunit.al#L27-L42).
