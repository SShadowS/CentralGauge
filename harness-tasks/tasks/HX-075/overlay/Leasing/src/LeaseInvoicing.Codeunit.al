codeunit 70311 "CGR Lease Invoicing"
{
    procedure InvoiceDueLines(ContractNo: Code[20]; UpToDate: Date): Integer
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        Setup: Record "CGR Setup";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        InvoiceNo: Code[20];
        Invoiced: Integer;
    begin
        Contract.Get(ContractNo);
        ScheduleLine.SetRange("Contract No.", ContractNo);
        ScheduleLine.SetRange(Invoiced, false);
        ScheduleLine.SetRange("Due Date", 0D, UpToDate);
        if not ScheduleLine.IsEmpty() then begin
            Setup.GetOrCreate();
            Setup."Last Lease Invoice No." += 1;
            Setup.Modify();
            InvoiceNo := CopyStr('LI' + Format(Setup."Last Lease Invoice No.", 0, 9), 1, MaxStrLen(InvoiceNo));
        end;
        if ScheduleLine.FindSet() then
            repeat
                CreateInvoiceLine(Contract, ScheduleLine, InvoiceNo);
                LeaseMgt.InvoiceLine(ContractNo, ScheduleLine."Line No.");
                Invoiced += 1;
            until ScheduleLine.Next() = 0;
        exit(Invoiced);
    end;

    procedure InvoiceDate(DueDate: Date): Date
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        if WorkingDays.IsWorkingDay(DueDate) then
            exit(DueDate);
        exit(WorkingDays.NextWorkingDay(DueDate));
    end;

    local procedure CreateInvoiceLine(Contract: Record "CGR Lease Contract"; ScheduleLine: Record "CGR Lease Schedule Line"; InvoiceNo: Code[20])
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
        InvoiceLine."Invoice No." := InvoiceNo;
        OnBeforeCreateInvoiceLine(ScheduleLine, InvoiceLine, IsHandled);
        if IsHandled then
            exit;
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
