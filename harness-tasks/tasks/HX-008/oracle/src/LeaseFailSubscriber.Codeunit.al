codeunit 85621 "HX008 Lease Fail Subscriber"
{
    EventSubscriberInstance = Manual;

    var
        FailingLines: Dictionary of [Text, Boolean];
        FailureErr: Label 'HX008 failure on %1 line %2.', Comment = '%1 = lease number, %2 = schedule line number';

    procedure FailOnScheduleLine(ContractNo: Code[20]; LineNo: Integer; CommitFirst: Boolean)
    begin
        FailingLines.Set(LineKey(ContractNo, LineNo), CommitFirst);
    end;

    local procedure LineKey(ContractNo: Code[20]; LineNo: Integer): Text
    begin
        exit(StrSubstNo('%1|%2', ContractNo, LineNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Invoicing", 'OnAfterCreateInvoiceLine', '', false, false)]
    local procedure FailInvoiceLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line")
    var
        CommitFirst: Boolean;
    begin
        if not FailingLines.Get(LineKey(ScheduleLine."Contract No.", ScheduleLine."Line No."), CommitFirst) then
            exit;
        if CommitFirst then
            Commit();
        Error(FailureErr, ScheduleLine."Contract No.", ScheduleLine."Line No.");
    end;
}
