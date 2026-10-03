codeunit 85761 "HX015 Posting Event Spy"
{
    EventSubscriberInstance = Manual;

    var
        BeforeCount: Integer;
        AfterCount: Integer;
        FailingContractNo: Code[20];
        ExtensionFailureErr: Label 'HX015 extension failure for %1.', Comment = '%1 = contract number';

    procedure FailAfterCommitFor(ContractNo: Code[20])
    begin
        FailingContractNo := ContractNo;
    end;

    procedure BeforePostCount(): Integer
    begin
        exit(BeforeCount);
    end;

    procedure AfterPostCount(): Integer
    begin
        exit(AfterCount);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental-Post", 'OnBeforePostRentalContract', '', false, false)]
    local procedure CountBeforePost(var RentalContract: Record "CGR Rental Contract")
    begin
        BeforeCount += 1;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental-Post", 'OnAfterPostRentalContract', '', false, false)]
    local procedure CountAfterPost(var RentalContract: Record "CGR Rental Contract"; Amount: Decimal)
    begin
        AfterCount += 1;
        if (FailingContractNo = '') or (RentalContract."No." <> FailingContractNo) then
            exit;
        Commit();
        Error(ExtensionFailureErr, RentalContract."No.");
    end;
}
