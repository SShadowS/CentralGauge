codeunit 80114 "CGR Posting Event Naive Spy"
{
    EventSubscriberInstance = Manual;

    var
        WatchedContractNo: Code[20];
        ExtraDays: Integer;
        BeforeCalls: Integer;
        LastAmount: Decimal;
        LastStatus: Enum "CGR Rental Status";

    procedure ExtendContract(ContractNo: Code[20]; Days: Integer)
    begin
        WatchedContractNo := ContractNo;
        ExtraDays := Days;
    end;

    procedure BeforeCount(): Integer
    begin
        exit(BeforeCalls);
    end;

    procedure PostedAmount(): Decimal
    begin
        exit(LastAmount);
    end;

    procedure PostedStatus(): Enum "CGR Rental Status"
    begin
        exit(LastStatus);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental-Post", 'OnBeforePostRentalContract', '', false, false)]
    local procedure ExtendBeforePosting(var RentalContract: Record "CGR Rental Contract")
    begin
        BeforeCalls += 1;
        if (WatchedContractNo <> '') and (RentalContract."No." = WatchedContractNo) then
            RentalContract."End Date" := RentalContract."End Date" + ExtraDays;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental-Post", 'OnAfterPostRentalContract', '', false, false)]
    local procedure RecordAfterPosting(var RentalContract: Record "CGR Rental Contract"; Amount: Decimal)
    begin
        LastAmount := Amount;
        LastStatus := RentalContract.Status;
    end;
}
