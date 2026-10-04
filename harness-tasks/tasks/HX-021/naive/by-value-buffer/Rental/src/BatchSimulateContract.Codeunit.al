codeunit 70215 "CGR Batch Simulate Contract"
{
    TableNo = "CGR Rental Ledger Entry";

    var
        SimulationDoneErr: Label 'Simulated posting of %1 is rolled back.', Comment = '%1 = contract number';

    trigger OnRun()
    begin
        PostAndCapture(Rec);
        Error(SimulationDoneErr, Rec."Contract No.");
    end;

    [CommitBehavior(CommitBehavior::Ignore)]
    local procedure PostAndCapture(var LedgerBuffer: Record "CGR Rental Ledger Entry")
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        RentalPost: Codeunit "CGR Rental-Post";
    begin
        Contract.Get(LedgerBuffer."Contract No.");
        RentalPost.Run(Contract);
        LedgerEntry.SetRange("Contract No.", Contract."No.");
        LedgerEntry.FindLast();
        CaptureSimulatedEntry(LedgerBuffer, LedgerEntry, LedgerBuffer."Entry No.");
    end;

    local procedure CaptureSimulatedEntry(LedgerBuffer: Record "CGR Rental Ledger Entry" temporary; LedgerEntry: Record "CGR Rental Ledger Entry"; EntryNo: Integer)
    begin
        LedgerBuffer := LedgerEntry;
        LedgerBuffer."Entry No." := EntryNo;
        LedgerBuffer.Insert();
    end;
}
