codeunit 80075 "CGR Lease Invoice Spy"
{
    EventSubscriberInstance = Manual;

    var
        SeenBeforeLine: Record "CGR Lease Invoice Line";
        HandleEveryLine: Boolean;
        ChangeEveryLine: Boolean;
        ChangedAmount: Decimal;
        ChangedInvoiceDate: Date;
        BeforeHits: Integer;
        AfterHits: Integer;
        AfterFound: Integer;

    procedure SetHandleLines(Handled: Boolean)
    begin
        HandleEveryLine := Handled;
    end;

    procedure SetLineChange(NewAmount: Decimal; NewInvoiceDate: Date)
    begin
        ChangeEveryLine := true;
        ChangedAmount := NewAmount;
        ChangedInvoiceDate := NewInvoiceDate;
    end;

    procedure BeforeHitCount(): Integer
    begin
        exit(BeforeHits);
    end;

    procedure AfterHitCount(): Integer
    begin
        exit(AfterHits);
    end;

    procedure AfterLinesFoundCount(): Integer
    begin
        exit(AfterFound);
    end;

    procedure GetSeenBeforeLine(var SeenLine: Record "CGR Lease Invoice Line")
    begin
        SeenLine := SeenBeforeLine;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Invoicing", 'OnBeforeCreateInvoiceLine', '', false, false)]
    local procedure RecordBeforeLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line"; var IsHandled: Boolean)
    begin
        BeforeHits += 1;
        SeenBeforeLine := InvoiceLine;
        if ChangeEveryLine then begin
            InvoiceLine.Amount := ChangedAmount;
            InvoiceLine."Invoice Date" := ChangedInvoiceDate;
        end;
        if HandleEveryLine then
            IsHandled := true;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Invoicing", 'OnAfterCreateInvoiceLine', '', false, false)]
    local procedure RecordAfterLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line")
    var
        StoredLine: Record "CGR Lease Invoice Line";
    begin
        AfterHits += 1;
        if StoredLine.Get(InvoiceLine."Contract No.", InvoiceLine."Schedule Line No.") then
            AfterFound += 1;
    end;
}
