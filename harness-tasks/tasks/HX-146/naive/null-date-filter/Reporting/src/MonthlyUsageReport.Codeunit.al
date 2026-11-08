codeunit 70562 "CGR Monthly Usage Report"
{
    procedure FillMonthlyUsage(FromDate: Date; ToDate: Date; var Buffer: Record "CGR Monthly Usage Buffer" temporary)
    var
        PeriodUsage: Query "CGR Vehicle Period Usage";
    begin
        Buffer.Reset();
        Buffer.DeleteAll();
        PeriodUsage.SetRange(Blocked, false);
        PeriodUsage.SetFilter(PostingDateFilter, '%1|%2..%3', 0D, FromDate, ToDate);
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
    end;
}
