codeunit 70562 "CGR Monthly Usage Report"
{
    procedure FillMonthlyUsage(FromDate: Date; ToDate: Date; var Buffer: Record "CGR Monthly Usage Buffer" temporary)
    var
        Vehicle: Record "CGR Vehicle";
        PeriodUsage: Query "CGR Vehicle Period Usage";
    begin
        Buffer.Reset();
        Buffer.DeleteAll();
        Vehicle.SetRange(Blocked, false);
        if Vehicle.FindSet() then
            repeat
                Buffer.Init();
                Buffer."Vehicle No." := Vehicle."No.";
                Buffer.Insert();
            until Vehicle.Next() = 0;

        PeriodUsage.SetRange(Blocked, false);
        PeriodUsage.SetRange(PostingDateFilter, FromDate, ToDate);
        PeriodUsage.Open();
        while PeriodUsage.Read() do
            if Buffer.Get(PeriodUsage.VehicleNo) then begin
                Buffer.Revenue := PeriodUsage.Revenue;
                Buffer."Km Driven" := PeriodUsage.KmDriven;
                Buffer.Rentals := PeriodUsage.Rentals;
                Buffer.Modify();
            end;
        PeriodUsage.Close();
    end;
}
