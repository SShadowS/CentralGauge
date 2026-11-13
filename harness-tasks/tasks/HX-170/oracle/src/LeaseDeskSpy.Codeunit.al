codeunit 88511 "HX170 Lease Desk Spy"
{
    EventSubscriberInstance = Manual;

    var
        WatchedLease: Code[20];
        RepricedLineNo: Integer;
        RepricedAmount: Decimal;
        HandledLineNo: Integer;
        StampRefs: Boolean;
        OwnLineNo: Integer;
        OwnLineAmount: Decimal;
        BeforeEvents: Integer;

    procedure InsertOwnInvoiceLine(LineNo: Integer; OwnAmount: Decimal)
    begin
        OwnLineNo := LineNo;
        OwnLineAmount := OwnAmount;
    end;

    procedure BeforeEventCount(): Integer
    begin
        exit(BeforeEvents);
    end;

    procedure ResetCounts()
    begin
        BeforeEvents := 0;
    end;

    procedure WatchLease(LeaseNo: Code[20])
    begin
        WatchedLease := LeaseNo;
    end;

    procedure RepriceLine(LineNo: Integer; NewAmount: Decimal)
    begin
        RepricedLineNo := LineNo;
        RepricedAmount := NewAmount;
    end;

    procedure HandleLine(LineNo: Integer)
    begin
        HandledLineNo := LineNo;
    end;

    procedure PostLikeAccounting()
    begin
        StampRefs := true;
    end;

    procedure ExpectedRef(LineNo: Integer): Code[20]
    begin
        exit(CopyStr('ACC-' + Format(LineNo), 1, 20));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Invoicing", 'OnBeforeCreateInvoiceLine', '', false, false)]
    local procedure RepriceOrHandle(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line"; var IsHandled: Boolean)
    begin
        if InvoiceLine."Contract No." <> WatchedLease then
            exit;
        BeforeEvents += 1;
        if (OwnLineNo <> 0) and (InvoiceLine."Schedule Line No." = OwnLineNo) then begin
            InvoiceLine.Amount := OwnLineAmount;
            InvoiceLine.Insert();
            IsHandled := true;
            exit;
        end;
        if (RepricedLineNo <> 0) and (InvoiceLine."Schedule Line No." = RepricedLineNo) then
            InvoiceLine.Amount := RepricedAmount;
        if (HandledLineNo <> 0) and (InvoiceLine."Schedule Line No." = HandledLineNo) then
            IsHandled := true;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Invoicing", 'OnAfterCreateInvoiceLine', '', false, false)]
    local procedure RecordAccountingRef(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line")
    var
        StoredLine: Record "CGR Lease Schedule Line";
    begin
        if (InvoiceLine."Contract No." <> WatchedLease) or not StampRefs then
            exit;
        StoredLine.Get(InvoiceLine."Contract No.", InvoiceLine."Schedule Line No.");
        StoredLine."Accounting Ref." := ExpectedRef(InvoiceLine."Schedule Line No.");
        StoredLine.Modify();
    end;
}
