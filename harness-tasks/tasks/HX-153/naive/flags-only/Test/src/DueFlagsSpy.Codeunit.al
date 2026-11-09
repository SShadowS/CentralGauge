codeunit 80607 "CGR Due Flags Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedContractNo: Code[20];
        RefusedLineNo: Integer;
        AccountingRefusalErr: Label 'Accounting refused line %1 of lease %2.', Comment = '%1 = line number, %2 = lease number';

    procedure RefuseLine(ContractNo: Code[20]; LineNo: Integer)
    begin
        RefusedContractNo := ContractNo;
        RefusedLineNo := LineNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Due Line Run", 'OnAfterInvoiceLine', '', false, false)]
    local procedure RefuseChosenLine(Line: Record "CGR Lease Schedule Line")
    begin
        if (RefusedContractNo <> '') and (Line."Contract No." = RefusedContractNo) and (Line."Line No." = RefusedLineNo) then
            Error(AccountingRefusalErr, Line."Line No.", Line."Contract No.");
    end;
}
