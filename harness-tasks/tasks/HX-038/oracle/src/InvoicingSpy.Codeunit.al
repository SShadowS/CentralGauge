codeunit 86221 "HX038 Invoicing Spy"
{
    EventSubscriberInstance = Manual;

    var
        BeforeCount: Integer;
        AfterCount: Integer;
        AfterStoredCount: Integer;
        OverrideAmount: Boolean;
        NewAmount: Decimal;
        HandledLineNo: Integer;

    procedure SetAmountOverride(Amount: Decimal)
    begin
        OverrideAmount := true;
        NewAmount := Amount;
    end;

    procedure SetHandledLine(ScheduleLineNo: Integer)
    begin
        HandledLineNo := ScheduleLineNo;
    end;

    procedure BeforeEvents(): Integer
    begin
        exit(BeforeCount);
    end;

    procedure AfterEvents(): Integer
    begin
        exit(AfterCount);
    end;

    procedure AfterEventsWithStoredLine(): Integer
    begin
        exit(AfterStoredCount);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Invoicing", 'OnBeforeCreateInvoiceLine', '', false, false)]
    local procedure OnBeforeCreateInvoiceLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line"; var IsHandled: Boolean)
    begin
        BeforeCount += 1;
        if OverrideAmount then
            InvoiceLine.Amount := NewAmount;
        if (HandledLineNo <> 0) and (ScheduleLine."Line No." = HandledLineNo) then
            IsHandled := true;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Invoicing", 'OnAfterCreateInvoiceLine', '', false, false)]
    local procedure OnAfterCreateInvoiceLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line")
    var
        StoredInvoiceLine: Record "CGR Lease Invoice Line";
    begin
        AfterCount += 1;
        if StoredInvoiceLine.Get(ScheduleLine."Contract No.", ScheduleLine."Line No.") then
            AfterStoredCount += 1;
    end;
}
