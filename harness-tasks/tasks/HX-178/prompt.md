# Feature 5178: Lease charges in the general journal

Requested by Finance.

Finance books our lease charges by hand from the lease invoice lines into a general journal and wants that done by code. Every lease (`CGR Lease Contract`, Leasing) now carries its own dimensions in "Dimension Set ID", and a lease for a customer project also carries the project's job in "Job No.".

Add this procedure to `CGR Lease Invoicing` (Leasing):

- `procedure TransferToGeneralJournal(ContractNo: Code[20]; TemplateName: Code[10]; BatchName: Code[10]; AccountNo: Code[20]): Integer`

It creates, in the given general journal batch, one journal line for each invoice line (`CGR Lease Invoice Line`) of the lease, and returns how many lines it created. Each line is a G/L account line for AccountNo, dated on the invoice line's "Invoice Date", with the invoice line's Amount and the lease number as document number, and it carries exactly the lease's dimensions. The lines of a lease with a job are booked to that job, and finance must see on them every dimension of the lease with the lease's own values, just as on any other lease. Nothing is posted.

Keep the signatures of the existing procedures of `CGR Lease Invoicing`.
