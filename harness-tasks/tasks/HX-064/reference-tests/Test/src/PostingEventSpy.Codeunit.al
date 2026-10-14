codeunit 80114 "CGR Posting Event Spy"
{
    EventSubscriberInstance = Manual;

    var
        WatchedContractNo: Code[20];
        ExtraDays: Integer;
        BeforeCalls: Integer;
        AfterCalls: Integer;
        SeenAmount: Decimal;
        SeenRecStatus: Enum "CGR Rental Status";
        SeenStoredStatus: Enum "CGR Rental Status";
        SeenLedgerEntry: Boolean;

    procedure ExtendContract(ContractNo: Code[20]; Days: Integer)
    begin
        WatchedContractNo := ContractNo;
        ExtraDays := Days;
    end;

    procedure BeforeCount(): Integer
    begin
        exit(BeforeCalls);
    end;

    procedure AfterCount(): Integer
    begin
        exit(AfterCalls);
    end;

    procedure AfterAmount(): Decimal
    begin
        exit(SeenAmount);
    end;

    procedure AfterRecStatus(): Enum "CGR Rental Status"
    begin
        exit(SeenRecStatus);
    end;

    procedure AfterStoredStatus(): Enum "CGR Rental Status"
    begin
        exit(SeenStoredStatus);
    end;

    procedure AfterLedgerEntryExisted(): Boolean
    begin
        exit(SeenLedgerEntry);
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
    var
        StoredContract: Record "CGR Rental Contract";
        Entry: Record "CGR Rental Ledger Entry";
    begin
        AfterCalls += 1;
        SeenAmount := Amount;
        SeenRecStatus := RentalContract.Status;
        if StoredContract.Get(RentalContract."No.") then
            SeenStoredStatus := StoredContract.Status;
        Entry.SetRange("Contract No.", RentalContract."No.");
        SeenLedgerEntry := not Entry.IsEmpty();
    end;
}
