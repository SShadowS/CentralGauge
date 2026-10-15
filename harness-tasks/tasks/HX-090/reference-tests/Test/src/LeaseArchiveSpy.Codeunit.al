codeunit 80152 "CGR Lease Archive Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedLeaseNo: Code[20];
        RefusedLineNo: Integer;
        CommitBeforeRefusal: Boolean;
        ArchiveRefusedErr: Label 'Archive refused lease %1 line %2.', Comment = '%1 = lease number, %2 = schedule line number';

    procedure RefuseLine(LeaseNo: Code[20]; LineNo: Integer; CommitFirst: Boolean)
    begin
        RefusedLeaseNo := LeaseNo;
        RefusedLineNo := LineNo;
        CommitBeforeRefusal := CommitFirst;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Invoicing", 'OnAfterCreateInvoiceLine', '', false, false)]
    local procedure ArchiveInvoiceLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line")
    begin
        if (RefusedLeaseNo = '') or (ScheduleLine."Contract No." <> RefusedLeaseNo) or (ScheduleLine."Line No." <> RefusedLineNo) then
            exit;
        if CommitBeforeRefusal then
            Commit();
        Error(ArchiveRefusedErr, ScheduleLine."Contract No.", ScheduleLine."Line No.");
    end;
}
