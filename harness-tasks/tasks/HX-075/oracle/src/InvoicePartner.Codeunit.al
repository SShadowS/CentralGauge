codeunit 86961 "HX075 Invoice Partner"
{
    EventSubscriberInstance = Manual;

    var
        PartnerLeaseNo: Code[20];
        PartnerLineNo: Integer;
        CommitAtLine: Boolean;
        RefuseAtLine: Boolean;
        HandleLines: Boolean;
        RefusedErr: Label 'HX075 archive refused %1 line %2.', Locked = true;

    procedure HX75SetLine(LeaseNo: Code[20]; LineNo: Integer; CommitFirst: Boolean; Refuse: Boolean)
    begin
        PartnerLeaseNo := LeaseNo;
        PartnerLineNo := LineNo;
        CommitAtLine := CommitFirst;
        RefuseAtLine := Refuse;
    end;

    procedure HX75SetHandled(Handled: Boolean)
    begin
        HandleLines := Handled;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Invoicing", 'OnBeforeCreateInvoiceLine', '', false, false)]
    local procedure HX75HandleLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line"; var IsHandled: Boolean)
    begin
        IsHandled := HandleLines;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Invoicing", 'OnAfterCreateInvoiceLine', '', false, false)]
    local procedure HX75ArchiveLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line")
    begin
        if (PartnerLeaseNo = '') or (ScheduleLine."Contract No." <> PartnerLeaseNo) or (ScheduleLine."Line No." <> PartnerLineNo) then
            exit;
        if CommitAtLine then
            Commit();
        if RefuseAtLine then
            Error(RefusedErr, ScheduleLine."Contract No.", Format(ScheduleLine."Line No.", 0, 9));
    end;
}
