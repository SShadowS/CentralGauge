codeunit 70205 "CGR Rental-Post Ledger"
{
    procedure InsertEntry(Contract: Record "CGR Rental Contract"; Amount: Decimal)
    var
        Entry: Record "CGR Rental Ledger Entry";
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(Contract."Vehicle No.");
        Entry.Init();
        Entry."Contract No." := Contract."No.";
        Entry."Vehicle No." := Contract."Vehicle No.";
        Entry."Posting Date" := Contract."End Date";
        Entry.Amount := Amount;
        Entry."Km Driven" := Vehicle.Mileage - Contract."Start Km";
        Entry.Insert(true);
    end;
}
