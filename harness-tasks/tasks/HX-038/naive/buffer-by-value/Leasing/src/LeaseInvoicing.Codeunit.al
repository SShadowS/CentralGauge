codeunit 70311 "CGR Lease Invoicing"
{
    procedure InvoiceDueLines(ContractNo: Code[20]; UpToDate: Date): Integer
    var
        TempInvoiceLine: Record "CGR Lease Invoice Line" temporary;
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Invoiced: Integer;
    begin
        ProposeInvoiceLines(ContractNo, UpToDate, TempInvoiceLine);
        if TempInvoiceLine.FindSet() then
            repeat
                CreateInvoiceLine(TempInvoiceLine);
                LeaseMgt.InvoiceLine(ContractNo, TempInvoiceLine."Schedule Line No.");
                Invoiced += 1;
            until TempInvoiceLine.Next() = 0;
        exit(Invoiced);
    end;

    procedure ProposeInvoiceLines(ContractNo: Code[20]; UpToDate: Date; var InvoiceBuffer: Record "CGR Lease Invoice Line" temporary)
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        InvoiceBuffer.Reset();
        InvoiceBuffer.DeleteAll();
        Contract.Get(ContractNo);
        ScheduleLine.SetRange("Contract No.", ContractNo);
        ScheduleLine.SetRange(Invoiced, false);
        ScheduleLine.SetRange("Due Date", 0D, UpToDate);
        if ScheduleLine.FindSet() then
            repeat
                AddProposalLine(InvoiceBuffer, Contract, ScheduleLine);
            until ScheduleLine.Next() = 0;
    end;

    local procedure AddProposalLine(InvoiceBuffer: Record "CGR Lease Invoice Line" temporary; Contract: Record "CGR Lease Contract"; ScheduleLine: Record "CGR Lease Schedule Line")
    var
        AmountRounding: Codeunit "CGR Amount Rounding";
    begin
        InvoiceBuffer.Init();
        InvoiceBuffer."Contract No." := Contract."No.";
        InvoiceBuffer."Schedule Line No." := ScheduleLine."Line No.";
        InvoiceBuffer."Vehicle No." := Contract."Vehicle No.";
        InvoiceBuffer."Customer Name" := Contract."Customer Name";
        InvoiceBuffer."Due Date" := ScheduleLine."Due Date";
        InvoiceBuffer."Invoice Date" := InvoiceDate(ScheduleLine."Due Date");
        InvoiceBuffer.Amount := AmountRounding.RoundAmount(ScheduleLine.Amount);
        InvoiceBuffer.Insert();
    end;

    procedure InvoiceDate(DueDate: Date): Date
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        if WorkingDays.IsWorkingDay(DueDate) then
            exit(DueDate);
        exit(WorkingDays.NextWorkingDay(DueDate));
    end;

    local procedure CreateInvoiceLine(var ProposedLine: Record "CGR Lease Invoice Line" temporary)
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
        IsHandled: Boolean;
    begin
        ScheduleLine.Get(ProposedLine."Contract No.", ProposedLine."Schedule Line No.");
        InvoiceLine := ProposedLine;
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
