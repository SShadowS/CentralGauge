# Feature 7425: Show what a batch posting run would do before we run it

Reported by Finance.

At month end we post returned rental contracts with `CGR Rental Batch Post` (PostBatch). Before starting a run we want to see what it would do: which contracts would post with which rental ledger entry, and which would fail and why. Several extensions subscribe to rental posting (they check contracts, refuse some, write their own data, some commit), so the answer has to be what posting would really do with those extensions active, not an estimate.

Requirement:

- Add to `CGR Rental Batch Post`: `procedure SimulateBatch(var ContractFilter: Record "CGR Rental Contract"; var LedgerBuffer: Record "CGR Rental Ledger Entry" temporary; var ErrorBuffer: Record "CGR Batch Post Error" temporary): Integer`.
- It covers the contracts PostBatch would post with the same filter: every contract with status Returned within the filters set on ContractFilter.
- For each of them that posting would post now, LedgerBuffer gets one row: the rental ledger entry posting would create, with every field except "Entry No." equal to that entry.
- For each of them that posting would refuse, including a refusal raised by an extension subscribed to the posting events of `CGR Rental-Post`, ErrorBuffer gets one row with the contract's "Contract No." and, as "Error Message", the error text posting would raise.
- It returns the number of contracts that would post.
- Both buffers are replaced on every call: afterwards they hold only the rows of this simulation, whatever they held before.
- Simulating changes no data: no rental ledger entry is created, no contract changes status, nothing is logged in `CGR Batch Post Error`, and nothing an extension writes while a contract is simulated is kept, also when that extension commits.
- PostBatch keeps its current behaviour.
