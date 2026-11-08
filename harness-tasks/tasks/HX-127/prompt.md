# Feature 8170: Save a desk selection and open it again later

Requested by the Rental desk and the Lease desk.

Users want to save the selection they have on screen under a code, so that the night run or a colleague can open the same selection later. Each desk scopes what its users see (`CGR Rental Desk Scope` by branch, `CGR Lease Desk Scope` by start period); users then add their own filters and choose the order. The desks pass the selection as a RecordRef.

Add a Core codeunit `CGR Desk Selection Store` with `SaveSelection(SelectionCode: Code[20]; var Selection: RecordRef)` and `OpenSelection(SelectionCode: Code[20]; var Selection: RecordRef)`, and whatever it needs to keep saved selections.

Contract: opening a saved selection gives back what was on screen: the same table, the same order, the desk's scope, and the user's own filters as the user set them, which the user can still change or clear without leaving the desk's scope. It is a selection, not a list of records, so a record created later that matches it is in it; partner apps save selections of their own tables, scoped the same way. Saving under a code that already exists replaces it, and opening a code that was never saved stops with the error 'There is no saved selection %1.' (%1 is the code).
