codeunit 70205 "CGR Rental-Post Ledger"
{
    procedure InsertEntry(Contract: Record "CGR Rental Contract"; Amount: Decimal)
    var
        Entry: Record "CGR Rental Ledger Entry";
        UnusedBranch: Code[10];
    begin
        Entry.Init();
        Entry."Contract No." := Contract."No.";
        Entry."Vehicle No." := Contract."Vehicle No.";
        Entry."Posting Date" := Contract."End Date";
        Entry.Amount := Amount;
        Entry."Km Driven" := Contract."Return Km" - Contract."Start Km";
        Entry."Branch Code" := Contract."Branch Code";
        Entry.Insert(true);
    end;
}
