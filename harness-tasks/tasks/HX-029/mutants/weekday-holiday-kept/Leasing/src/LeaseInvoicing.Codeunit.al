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
        ScheduleLine.SetRange("Due Date", 0D, UpToDate);
        if ScheduleLine.FindSet() then
            repeat
                CreateInvoiceLine(Contract, ScheduleLine);
                LeaseMgt.InvoiceLine(ContractNo, ScheduleLine."Line No.");
                Invoiced += 1;
            until ScheduleLine.Next() = 0;
        exit(Invoiced);
    end;

    procedure InvoiceDate(DueDate: Date): Date
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        if Date2DWY(DueDate, 1) in [6, 7] then
            exit(WorkingDays.NextWorkingDay(DueDate));
        exit(DueDate);
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

    [IntegrationEvent(false, false)]
    local procedure OnBeforeCreateInvoiceLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line"; var IsHandled: Boolean)
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterCreateInvoiceLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line")
    begin
    end;
}
