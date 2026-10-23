codeunit 70521 "CGR Service Date Report"
{
    procedure ListServicedBetween(FromDate: Date; ToDate: Date; var VehicleNos: List of [Code[20]]): Integer
    var
        ServiceDates: Query "CGR Service Date List";
    begin
        if FromDate = 0D then
            ServiceDates.SetFilter(ServiceDateFilter, '..%1', ToDate)
        else
            ServiceDates.SetRange(ServiceDateFilter, FromDate, ToDate);
        ServiceDates.Open();
        while ServiceDates.Read() do
            if ServiceDates.LastServiceDate <> 0D then
                VehicleNos.Add(ServiceDates.VehicleNo);
        ServiceDates.Close();
        exit(VehicleNos.Count());
    end;
}
