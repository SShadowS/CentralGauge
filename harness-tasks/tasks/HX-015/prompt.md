# Task 7380: Show the rental ledger entry before posting

Reported by the front desk.

Before posting a returned rental contract, the front desk wants to see the rental ledger entry that posting will create, so a wrong amount or km reading is caught before it reaches the ledger. Today the only way to see the entry is to post the contract.

Requirement:

- Add to `CGR Rental Mgt`: `procedure PreviewPosting(ContractNo: Code[20]; var LedgerBuffer: Record "CGR Rental Ledger Entry" temporary)`. It fills LedgerBuffer with the rental ledger entry that posting the contract now (`CGR Rental Mgt`, Post) would create: the same "Contract No.", "Vehicle No.", "Posting Date", Amount and "Km Driven". Whatever LedgerBuffer held before the call is replaced: afterwards it holds only that entry.
- A preview changes nothing in the database: the contract keeps its status and no rental ledger entry is created.
- A preview does not run the extensions subscribed to the posting events of `CGR Rental-Post`.
- A contract that posting would refuse because it is not returned cannot be previewed either: the preview fails with the same error as posting.
- Posting and the preview must build the ledger entry with the same code, so the two cannot drift apart. Posting itself keeps its current behaviour, including its events.
