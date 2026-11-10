codeunit 70484 "CGR Ledger Export Job"
{
    trigger OnRun()
    var
        Entry: Record "CGR Rental Ledger Entry";
        Setup: Record "CGR Export Setup";
        Export: Codeunit "CGR Ledger Export";
        FileText: Text;
    begin
        Setup.Get();
        Entry.SetFilter("Entry No.", '>%1', Setup."Last Exported Entry No.");
        if Entry.IsEmpty() then
            exit;
        FileText := Export.BuildFile(Entry);
        OnSendLedgerFile(FileText);
        Entry.FindLast();
        Setup."Last Exported Entry No." := Entry."Entry No.";
        Setup.Modify();
    end;

    [IntegrationEvent(false, false)]
    local procedure OnSendLedgerFile(FileText: Text)
    begin
    end;
}
