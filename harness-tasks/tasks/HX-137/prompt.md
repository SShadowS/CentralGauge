# Bug 5817: Every tenth new contract fails with "already exists"

Reported by the Front desk.

Last sprint, to stop lock waits on the setup row, contract numbers started coming from `CGR Contract No. Pool` (Core), a single-instance codeunit that reserves numbers from `CGR Setup`."Last Contract No." in blocks of 10 and hands them out one by one in the session; its `Reset` ends the session's block. `CGR Rental Mgt` takes the numbers of `CreateContract` and of the new `CopyContract` from the pool, and both raise `OnAfterContractCreated`, where partner apps may refuse a contract with an error.

Observed: at every desk, roughly every tenth new contract fails with "The record in table CGR Rental Contract already exists". Pressing the button again works. The duplicate is always the last number of the previous block of that session.

Expected (unchanged from the original request): a contract number is never given to two contracts, also when several sessions create contracts at the same time, and also when the creation of a contract fails; numbers may be skipped (a session that ends with unused numbers leaves a gap). The setup row is touched once per 10 contracts per session, not once per contract: "Last Contract No." holds the last number of the most recently reserved block. Numbers have the format `RC<number>`.

`CreateContract` is called from the desk, from a booking import that runs one booking per `Codeunit.Run` (a failed booking is rolled back and logged), and from other apps inside their own transactions.

Keep the public procedures of `CGR Contract No. Pool` and `CGR Rental Mgt`, and the event `OnAfterContractCreated`.
