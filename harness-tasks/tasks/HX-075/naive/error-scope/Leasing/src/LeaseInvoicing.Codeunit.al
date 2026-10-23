codeunit 70311 "CGR Lease Invoicing"
{
    procedure InvoiceDueLines(ContractNo: Code[20]; UpToDate: Date): Integer
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        Contract.Get(ContractNo);
        ScheduleLine.SetRange("Contract No.", ContractNo);
        ScheduleLine.SetRange(Invoiced, false);
        ScheduleLine.SetRange("Due Date", 0D, UpToDate);
        exit(InvoiceScheduleLines(Contract, ScheduleLine));
    end;

    procedure NextLeaseInvoiceNo(): Code[20]
    var
        Setup: Record "CGR Setup";
    begin
        Setup.GetOrCreate();
        Setup."Last Lease Invoice No." += 1;
        Setup.Modify();
        exit(CopyStr('LI' + Format(Setup."Last Lease Invoice No.", 0, 9), 1, 20));
    end;

    procedure InvoiceDate(DueDate: Date): Date
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        if WorkingDays.IsWorkingDay(DueDate) then
            exit(DueDate);
        exit(WorkingDays.NextWorkingDay(DueDate));
    end;

    [CommitBehavior(CommitBehavior::Error)]
    local procedure InvoiceScheduleLines(Contract: Record "CGR Lease Contract"; var ScheduleLine: Record "CGR Lease Schedule Line"): Integer
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        InvoiceNo: Code[20];
        Invoiced: Integer;
    begin
        if ScheduleLine.FindSet() then
            repeat
                CreateInvoiceLine(Contract, ScheduleLine, InvoiceNo);
                LeaseMgt.InvoiceLine(Contract."No.", ScheduleLine."Line No.");
                Invoiced += 1;
            until ScheduleLine.Next() = 0;
        exit(Invoiced);
    end;

    local procedure CreateInvoiceLine(Contract: Record "CGR Lease Contract"; ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceNo: Code[20])
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
        if InvoiceNo = '' then
            InvoiceNo := NextLeaseInvoiceNo();
        InvoiceLine."Invoice No." := InvoiceNo;
        InvoiceLine.Insert(true);
        OnAfterCreateInvoiceLine(ScheduleLine, InvoiceLine);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeCreateInvoiceLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line"; var IsHandled: Boolean)
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterCreateInvoiceLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line")
    begin
    end;
}
