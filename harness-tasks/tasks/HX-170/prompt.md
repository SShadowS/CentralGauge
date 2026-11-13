# Bug 5170: Lease lines due on the run date are not invoiced

Reported by Accounts receivable.

The lease invoicing run (`CGR Lease Invoicing`.`InvoiceDueLines`, Leasing) creates an invoice line for each due schedule line and then marks the schedule line invoiced. The accounting app, which we cannot change, posts each invoice line from `OnAfterCreateInvoiceLine` and records its journal reference on the schedule line in "Accounting Ref."; collections reconcile invoiced lines by that reference. The desk now also needs to see on the schedule line what was actually invoiced, because `OnBeforeCreateInvoiceLine` subscribers may change the invoice line's amount; the new field "Billed Amount" is there but stays 0.

Observed: lines that fall due on the run date are left out of the run, and "Billed Amount" is 0 on every invoiced line.

Expected: a run invoices every line that is not invoiced and is due on or before UpToDate, and returns how many lines it processed. "Billed Amount" holds the amount of the line's invoice line; a line whose invoice line a subscriber handled itself is marked invoiced as before and has "Billed Amount" 0. Every invoiced line carries the journal reference the accounting app recorded for it.

Keep the public procedures and events of `CGR Lease Invoicing` and `CGR Lease Mgt`.

Shipped code:

```al
// Leasing: CGR Lease Schedule Line has "Contract No.", "Line No.", "Due Date", Amount, Invoiced, "Billed Amount" (Decimal), "Accounting Ref." (Code[20]).

codeunit 70311 "CGR Lease Invoicing"
{
    procedure InvoiceDueLines(ContractNo: Code[20]; UpToDate: Date): Integer
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Invoiced: Integer;
    begin
        Contract.Get(ContractNo);
        ScheduleLine.SetRange("Contract No.", ContractNo);
        ScheduleLine.SetRange(Invoiced, false);
        ScheduleLine.SetRange("Due Date", 0D, UpToDate - 1);
        if ScheduleLine.FindSet() then
            repeat
                CreateInvoiceLine(Contract, ScheduleLine);
                LeaseMgt.InvoiceLine(ContractNo, ScheduleLine."Line No.");
                Invoiced += 1;
            until ScheduleLine.Next() = 0;
        exit(Invoiced);
    end;

    local procedure CreateInvoiceLine(Contract: Record "CGR Lease Contract"; ScheduleLine: Record "CGR Lease Schedule Line")
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        AmountRounding: Codeunit "CGR Amount Rounding";
        IsHandled: Boolean;
    begin
        InvoiceLine.Init();
        InvoiceLine."Contract No." := Contract."No.";
        InvoiceLine."Schedule Line No." := ScheduleLine."Line No.";
        InvoiceLine."Vehicle No." := Contract."Vehicle No.";
        InvoiceLine."Customer Name" := Contract."Customer Name";
        InvoiceLine."Due Date" := ScheduleLine."Due Date";
        InvoiceLine."Invoice Date" := InvoiceDate(ScheduleLine."Due Date");
        InvoiceLine.Amount := AmountRounding.RoundAmount(ScheduleLine.Amount);
        OnBeforeCreateInvoiceLine(ScheduleLine, InvoiceLine, IsHandled);
        if IsHandled then
            exit;
        InvoiceLine.Insert(true);
        OnAfterCreateInvoiceLine(ScheduleLine, InvoiceLine);
    end;

    // InvoiceDate(DueDate), OnBeforeCreateInvoiceLine(ScheduleLine; var InvoiceLine; var IsHandled), OnAfterCreateInvoiceLine(ScheduleLine; var InvoiceLine)
}

codeunit 70300 "CGR Lease Mgt"
{
    procedure InvoiceLine(ContractNo: Code[20]; LineNo: Integer)
    var
        Line: Record "CGR Lease Schedule Line";
    begin
        Line.Get(ContractNo, LineNo);
        Line.Invoiced := true;
        Line.Modify(true);
    end;
}
```

Write the corrected AL for the affected procedures and explain briefly.
