codeunit 70562 "CGR Monthly Usage Report"
{
    procedure FillMonthlyUsage(FromDate: Date; ToDate: Date; var Buffer: Record "CGR Monthly Usage Buffer" temporary)
    var
        Vehicle: Record "CGR Vehicle";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        PeriodUsage: Query "CGR Vehicle Period Usage";
    begin
        Buffer.Reset();
        Buffer.DeleteAll();
        PeriodUsage.SetRange(Blocked, false);
        PeriodUsage.SetRange(PostingDateFilter, FromDate, ToDate);
        PeriodUsage.Open();
        while PeriodUsage.Read() do begin
            Buffer.Init();
            Buffer."Vehicle No." := PeriodUsage.VehicleNo;
            Buffer.Revenue := PeriodUsage.Revenue;
            Buffer."Km Driven" := PeriodUsage.KmDriven;
            Buffer.Rentals := PeriodUsage.Rentals;
            Buffer.Insert();
        end;
        PeriodUsage.Close();

        Vehicle.SetRange(Blocked, false);
        if Vehicle.FindSet() then
            repeat
                LedgerEntry.SetRange("Vehicle No.", Vehicle."No.");
                if LedgerEntry.IsEmpty() then begin
                    Buffer.Init();
                    Buffer."Vehicle No." := Vehicle."No.";
                    Buffer.Insert();
                end;
            until Vehicle.Next() = 0;
    end;
}
