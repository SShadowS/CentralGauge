codeunit 87321 "HX093 Posting Spy"
{
    EventSubscriberInstance = Manual;

    // Counts what posting did for one contract. The counters live in this instance, so a
    // rolled-back posting attempt does not reset them.
    var
        WatchedContractNo: Code[20];
        LedgerInserts: Integer;
        BalancingInserts: Integer;
        BeforePostCalls: Integer;

    procedure HX093Watch(ContractNo: Code[20])
    begin
        WatchedContractNo := ContractNo;
        LedgerInserts := 0;
        BalancingInserts := 0;
        BeforePostCalls := 0;
    end;

    procedure HX093LedgerInserts(): Integer
    begin
        exit(LedgerInserts);
    end;

    procedure HX093BalancingInserts(): Integer
    begin
        exit(BalancingInserts);
    end;

    procedure HX093BeforePostCalls(): Integer
    begin
        exit(BeforePostCalls);
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Rental Ledger Entry", 'OnAfterInsertEvent', '', false, false)]
    local procedure HX093OnLedgerInsert(var Rec: Record "CGR Rental Ledger Entry"; RunTrigger: Boolean)
    begin
        if Rec."Contract No." = WatchedContractNo then
            LedgerInserts += 1;
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Balancing Entry", 'OnAfterInsertEvent', '', false, false)]
    local procedure HX093OnBalancingInsert(var Rec: Record "CGR Balancing Entry"; RunTrigger: Boolean)
    begin
        if Rec."Contract No." = WatchedContractNo then
            BalancingInserts += 1;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental-Post", 'OnBeforePostRentalContract', '', false, false)]
    local procedure HX093OnBeforePost(var RentalContract: Record "CGR Rental Contract")
    begin
        if RentalContract."No." = WatchedContractNo then
            BeforePostCalls += 1;
    end;
}
