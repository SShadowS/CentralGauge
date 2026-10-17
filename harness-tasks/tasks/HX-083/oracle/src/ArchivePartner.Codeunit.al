codeunit 87121 "HX083 Archive Partner"
{
    EventSubscriberInstance = Manual;

    var
        HX083Seen: List of [Text];
        HX083RefuseKey: Text;
        HX083CommitFirst: Boolean;
        HX083RefuseLease: Code[20];
        HX083AfterFired: Boolean;
        LineRefusedErr: Label 'HX083 archive refused %1 %2.', Comment = '%1 = lease number, %2 = schedule line number';
        LeaseRefusedErr: Label 'HX083 archive refused %1.', Comment = '%1 = lease number';

    procedure HX83RefuseLine(LeaseNo: Code[20]; LineNo: Integer; CommitFirst: Boolean)
    begin
        HX083RefuseKey := HX83Key(LeaseNo, LineNo);
        HX083CommitFirst := CommitFirst;
    end;

    procedure HX83RefuseAfter(LeaseNo: Code[20])
    begin
        HX083RefuseLease := LeaseNo;
    end;

    procedure HX83Saw(LeaseNo: Code[20]; LineNo: Integer): Boolean
    begin
        exit(HX083Seen.Contains(HX83Key(LeaseNo, LineNo)));
    end;

    procedure HX83AfterRefused(): Boolean
    begin
        exit(HX083AfterFired);
    end;

    local procedure HX83Key(LeaseNo: Code[20]; LineNo: Integer): Text
    begin
        exit(StrSubstNo('%1|%2', LeaseNo, LineNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Invoicing", 'OnAfterCreateInvoiceLine', '', false, false)]
    local procedure HX83OnInvoiceLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line")
    var
        LineKey: Text;
    begin
        LineKey := HX83Key(ScheduleLine."Contract No.", ScheduleLine."Line No.");
        HX083Seen.Add(LineKey);
        if LineKey <> HX083RefuseKey then
            exit;
        if HX083CommitFirst then
            Commit();
        Error(LineRefusedErr, ScheduleLine."Contract No.", ScheduleLine."Line No.");
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Run Unit", 'OnAfterLeaseInvoiced', '', false, false)]
    local procedure HX83OnLeaseInvoiced(LeaseNo: Code[20])
    begin
        if (HX083RefuseLease = '') or (LeaseNo <> HX083RefuseLease) then
            exit;
        HX083AfterFired := true;
        Error(LeaseRefusedErr, LeaseNo);
    end;
}
