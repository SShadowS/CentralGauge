# Task 7395: Automated tests for rental batch posting

Reported by Finance.

Finance posts returned rental contracts in batches and then reviews the errors of that run. When they start a second batch run from the same batch posting session, the error list of the second run still shows the contracts that failed in the first run, although nothing failed in the second run.

Before anyone changes the batch posting code we want automated tests that pin down how batch posting must behave. Put them in a new test codeunit in the Test app. Do not fix the batch posting code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How batch posting must behave (`CGR Rental Batch Post`, procedures `PostBatch(var ContractFilter: Record "CGR Rental Contract"): Integer` and `LastBatchId(): Guid`; errors are recorded in table `CGR Batch Post Error`):

- PostBatch posts every contract with status Returned within the caller's filter, each through `CGR Rental-Post`. Contracts outside the filter and contracts with any other status are not touched.
- PostBatch returns the number of contracts it posted.
- A contract that fails to post is left exactly as it was before the attempt: still Returned and without a ledger entry. This also holds when an extension subscribing to the posting commits before it raises its error.
- Every contract that fails to post is recorded in `CGR Batch Post Error` with the batch id of the run, the contract number and the error text.
- A failure does not stop the run: the remaining contracts of the run are still posted.
- Every run of PostBatch gets its own batch id, also when the same `CGR Rental Batch Post` instance runs several batches. LastBatchId returns the batch id of the latest run.
