# Feature 7342: Revenue per branch and month

Reported by Controlling, head office.

Rental contracts store the branch they were created at ("Branch Code" on `CGR Rental Contract`), but the rental ledger does not, so Controlling cannot report rental revenue per branch. We need the branch on every ledger entry and a query that sums the ledger per branch and month.

Requirement:

- `CGR Rental Ledger Entry` gets a new field "Branch Code" (Code[10]).
- Every rental ledger entry posted for a contract carries the "Branch Code" of that contract. This holds both when the contract is posted on its own (`CGR Rental Mgt`, Post) and when it is posted in a batch (`CGR Rental Batch Post`), and whichever branch the user posting it is currently working in.
- New query 70511 `CGR Revenue by Branch Month` in the Reporting app, over the rental ledger entries. It returns one row per branch (the entry's "Branch Code"), posting year and posting month, with the columns:
  - `BranchCode`: the branch code,
  - `PostingYear` and `PostingMonth`: the year and the month of the posting date,
  - `Amount`: the total amount of the entries,
  - `EntryCount`: the number of entries.
- The query has a filter `PostingDateFilter` on the posting date so Controlling can restrict the report to a period of posting dates.
