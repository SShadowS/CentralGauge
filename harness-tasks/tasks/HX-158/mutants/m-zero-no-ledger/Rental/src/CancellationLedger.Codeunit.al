codeunit 70283 "CGR Cancellation Ledger"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Cancellation Run", 'OnAfterCancellationWritten', '', false, false)]
    local procedure WriteLedgerEntry(Entry: Record "CGR Cancellation Entry")
    var
        Contract: Record "CGR Rental Contract";
        PostLedger: Codeunit "CGR Rental-Post Ledger";
    begin
        if Entry."Fee Amount" = 0 then
            exit;
        Contract.Get(Entry."Contract No.");
        PostLedger.InsertEntry(Contract, Entry."Fee Amount");
    end;
}
