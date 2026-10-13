# Task 7552: One way to try posting a contract

Reported by Platform team.

`CGR Rental Batch Post`.PostBatch (Rental) posts every returned contract in a filter one at a time, and when one contract fails it logs the error and goes on with the next. The front desk and other apps now need the same for a single contract: try to post it, and learn whether it worked, without an error stopping them. We want that in one place, and batch posting should use it too.

Requirement:

- Add to `CGR Rental Mgt` the procedure `TryPost(ContractNo: Code[20]): Boolean`. It posts the contract the way batch posting posts one contract.
- When the contract is posted, TryPost returns true.
- When posting fails, TryPost returns false and raises no error, `GetLastErrorText()` returns the error the posting raised, and nothing of the attempted posting is kept, also when an extension subscribed to posting commits during it.
- `CGR Rental Batch Post`.PostBatch posts each contract through TryPost. What PostBatch returns, the errors it logs in `CGR Batch Post Error` and `LastBatchId` stay exactly as they are today.
