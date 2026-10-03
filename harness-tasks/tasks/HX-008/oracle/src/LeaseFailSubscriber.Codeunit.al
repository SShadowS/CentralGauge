codeunit 85621 "HX008 Lease Fail Subscriber"
{
    EventSubscriberInstance = Manual;

    var
        FailContractNo: Code[20];
        FailLineNo: Integer;
        CommitBeforeFailing: Boolean;
        FailureErr: Label 'HX008 failure on %1 line %2.', Comment = '%1 = lease number, %2 = schedule line number';

    procedure FailOnScheduleLine(ContractNo: Code[20]; LineNo: Integer; CommitFirst: Boolean)
    begin
        FailContractNo := ContractNo;
        FailLineNo := LineNo;
        CommitBeforeFailing := CommitFirst;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Invoicing", 'OnAfterCreateInvoiceLine', '', false, false)]
    local procedure FailInvoiceLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line")
    begin
        if (FailContractNo = '') or (ScheduleLine."Contract No." <> FailContractNo) or (ScheduleLine."Line No." <> FailLineNo) then
            exit;
        if CommitBeforeFailing then
            Commit();
        Error(FailureErr, ScheduleLine."Contract No.", ScheduleLine."Line No.");
    end;
}
