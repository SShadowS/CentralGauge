codeunit 80075 "CGR Lease Invoice Naive Spy"
{
    EventSubscriberInstance = Manual;

    var
        AfterFound: Integer;
        BeforeAmount: Decimal;
        BeforeInvoiceDate: Date;
        OverrideAmount: Boolean;
        NewAmount: Decimal;

    procedure ArchivedLineCount(): Integer
    begin
        exit(AfterFound);
    end;

    procedure SeenAmountBefore(): Decimal
    begin
        exit(BeforeAmount);
    end;

    procedure SeenInvoiceDateBefore(): Date
    begin
        exit(BeforeInvoiceDate);
    end;

    procedure SetAmountOverride(OverrideValue: Decimal)
    begin
        OverrideAmount := true;
        NewAmount := OverrideValue;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Invoicing", 'OnBeforeCreateInvoiceLine', '', false, false)]
    local procedure ReadInvoiceLineBefore(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line"; var IsHandled: Boolean)
    begin
        BeforeAmount := InvoiceLine.Amount;
        BeforeInvoiceDate := InvoiceLine."Invoice Date";
        if OverrideAmount then
            InvoiceLine.Amount := NewAmount;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Invoicing", 'OnAfterCreateInvoiceLine', '', false, false)]
    local procedure ArchiveInvoiceLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line")
    var
        StoredLine: Record "CGR Lease Invoice Line";
    begin
        if StoredLine.Get(InvoiceLine."Contract No.", InvoiceLine."Schedule Line No.") then
            AfterFound += 1;
    end;
}
