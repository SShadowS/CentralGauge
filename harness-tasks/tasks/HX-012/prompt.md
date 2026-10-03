# Bug 7358: Setup changes are ignored until users sign in again

Reported by IT operations.

When we change `CGR Setup` (Core), the users who are already working do not see the change. After we raised the amount rounding precision, the invoice previews of every open session kept rounding to cents; after we raised "Outbox Max Attempts", the outbox kept failing entries at the old limit; after we changed "Default Branch Code", new rental contracts kept getting the old branch. Everything is right again once the user signs out and back in.

Reproduction (one session):

1. Read the rounding precision once, for example by building an invoice preview (`CGR Rental Invoice Preview`, BuildPreview) or calling `CGR Amount Rounding`, Precision. Setup holds 0.01.
2. Change "Amount Rounding Precision" on the Setup record to 1 and save it with its table triggers (`Modify(true)`, as the Setup page and configuration packages do).
3. Build the preview again or call Precision again.

Observed: still 0.01. Expected: 1.

Expected behaviour:

- When the Setup record is inserted, modified or deleted with its table triggers running, the session sees the new Setup values at once: amount rounding, "Outbox Max Attempts" (`CGR Outbox Dispatcher`, MaxAttempts) and "Default Branch Code" (the current branch of a session without an explicitly chosen branch, and so the branch of new rental contracts). After a delete, the session behaves as it does today when no Setup record exists.
- Saves made without the table triggers (for example the contract number counter, or code calling `Modify()`) keep the values the session already read, as today.
- A branch the user explicitly chose for the session (`CGR Session Context`, SetCurrentBranch) stays chosen after a Setup save.
