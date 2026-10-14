# Feature 7664: Keep the quoted preview of each contract while the desk works

Reported by Front desk.

When a customer at the desk asks what a rental will cost, we show the invoice preview of the contract (`CGR Rental Invoice Preview`, BuildPreview). The desk handles several contracts at once and often comes back to a quote later in the session, but by then prices or the contract may have changed and BuildPreview shows today's lines, not what the customer was quoted. We need to keep the quoted preview of each contract for the rest of the session.

Requirement, in codeunit `CGR Rental Invoice Preview`:

- `KeepPreview(ContractNo: Code[20])` builds the preview of the contract exactly as BuildPreview does and keeps it for the rest of the session. A preview kept earlier for the same contract is replaced; previews kept for other contracts stay.
- `GetKeptPreview(ContractNo: Code[20]; var PreviewLine: Record "CGR Invoice Preview Line"): Boolean` returns true when a preview is kept for the contract, and PreviewLine then holds exactly the kept lines (whatever PreviewLine held before is gone). When no preview is kept for the contract, it returns false and PreviewLine is empty.
- A kept preview shows what it showed when it was kept: later changes to prices, Setup or the contract do not change it, and changing or deleting the lines handed out by GetKeptPreview does not change it either.
- Kept previews are shared by every `CGR Rental Invoice Preview` variable in the session.
- `ForgetKeptPreviews()` drops every kept preview.
- KeepPreview for a contract that does not exist, or whose preview cannot be built, fails with that error and leaves every kept preview as it was, including one kept earlier for the same contract.
- BuildPreview and TotalAmount behave as today and keep nothing.
