codeunit 70205 "CGR Rental-Post Ledger"
{
    procedure InsertEntry(Contract: Record "CGR Rental Contract"; Amount: Decimal)
    var
        Entry: Record "CGR Rental Ledger Entry";
        Vehicle: Record "CGR Vehicle";
    begin
        Entry.Init();
        Entry."Contract No." := Contract."No.";
        Entry."Vehicle No." := Contract."Vehicle No.";
        Entry."Posting Date" := Contract."End Date";
        Entry.Amount := Amount;
        if Vehicle.Get(Contract."Vehicle No.") and (Vehicle."Asset Type" = Vehicle."Asset Type"::Boat) then
            Entry."Engine Hours" := Contract."Return Km" - Contract."Start Km"
        else
            Entry."Km Driven" := Contract."Return Km" - Contract."Start Km";
        Entry.Insert(true);
    end;
}
