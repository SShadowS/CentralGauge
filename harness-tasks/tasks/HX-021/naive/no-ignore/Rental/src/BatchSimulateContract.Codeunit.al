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

    local procedure PostAndCapture(var LedgerBuffer: Record "CGR Rental Ledger Entry")
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        RentalPost: Codeunit "CGR Rental-Post";
        EntryNo: Integer;
    begin
        EntryNo := LedgerBuffer."Entry No.";
        Contract.Get(LedgerBuffer."Contract No.");
        RentalPost.Run(Contract);
        LedgerEntry.SetRange("Contract No.", Contract."No.");
        LedgerEntry.FindLast();
        LedgerBuffer := LedgerEntry;
        LedgerBuffer."Entry No." := EntryNo;
        LedgerBuffer.Insert();
    end;
}
