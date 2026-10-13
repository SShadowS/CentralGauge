# Feature 7496: Show the desk what it posted this session

Reported by the Front desk.

At the end of a shift the desk wants to see what it posted: how many rental contracts went through, for how much, and how many could not be posted. Today nothing keeps track of that.

Add a new codeunit `CGR Posting Summary` (Rental) with these procedures:

- `procedure PostedCount(): Integer`
- `procedure PostedAmount(): Decimal`
- `procedure FailedCount(): Integer`
- `procedure ResetSummary()`

Expected behaviour:

- Every rental contract that the session posts through `CGR Rental Mgt` (Post) or `CGR Rental Batch Post` (PostBatch) counts once.
- A contract that is posted counts as posted: PostedCount goes up by one and PostedAmount by the amount of the contract's rental ledger entry.
- A contract whose posting fails counts as failed, whatever made it fail: a contract that does not have the right status, or an extension that refuses the posting after the ledger entry was written. This also holds when Post raised the error to its caller.
- The figures belong to the session: every `CGR Posting Summary` variable in the session reports the same figures, and other sessions keep their own.
- ResetSummary sets all three figures to zero.
- Post and PostBatch otherwise behave as today: Post raises the posting's error to its caller, and PostBatch returns the number of contracts posted and logs the errors of the ones that failed.
