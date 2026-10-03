# Task 7482: Automated tests for lease invoicing

Reported by Finance.

Finance archives every lease invoice line through an extension that subscribes to the OnAfterCreateInvoiceLine event of `CGR Lease Invoicing` and reads the new line from the `CGR Lease Invoice Line` table. Since the last update the archive reports for every invoice line that the line does not exist, so nothing is archived.

Before anyone changes the lease invoicing code we want automated tests that pin down how lease invoicing and its events must behave. Put them in a new test codeunit in the Test app. Do not fix the lease invoicing code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How it must behave (`CGR Lease Invoicing`, procedures `InvoiceDueLines(ContractNo: Code[20]; UpToDate: Date): Integer` and `InvoiceDate(DueDate: Date): Date`, events `OnBeforeCreateInvoiceLine` and `OnAfterCreateInvoiceLine`):

- InvoiceDueLines invoices every schedule line of the lease that is not yet invoiced and whose due date is on or before UpToDate: it creates one invoice line for it and marks the schedule line invoiced. It returns the number of schedule lines it invoiced.
- An invoice line carries the lease's contract number, vehicle number and customer name, the schedule line's line number and due date, the schedule line's amount rounded to the "Amount Rounding Precision" in CGR Setup, and an invoice date.
- The invoice date (InvoiceDate) is the due date when the due date is a working day, otherwise the first working day after it. Saturdays, Sundays and the dates in `CGR Non-Working Day` are not working days; when several of them follow each other, all of them are skipped.
- OnBeforeCreateInvoiceLine receives the invoice line exactly as it will be inserted, with every field above filled in. A subscriber may change the line; the line is inserted with the subscriber's changes. A subscriber that sets IsHandled takes over the line: it is not inserted and OnAfterCreateInvoiceLine is not raised for it, but the schedule line is still marked invoiced and counted.
- OnAfterCreateInvoiceLine is raised for every inserted invoice line, once the line is in the database.
