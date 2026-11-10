codeunit 70187 "CGR Usage Settlement"
{
    procedure SettleUsagePeriod(var VehicleFilter: Record "CGR Vehicle"; FromDate: Date; ToDate: Date; AllowanceKm: Integer): Integer
    var
        Vehicle: Record "CGR Vehicle";
        Reading: Record "CGR Usage Reading";
        Charge: Record "CGR Usage Charge";
        Statistics: Codeunit "CGR Usage Statistics";
        FirstKm: Integer;
        KmDriven: Integer;
        KmOver: Integer;
        Settled: Integer;
    begin
        Vehicle.CopyFilters(VehicleFilter);
        if Vehicle.FindSet() then
            repeat
                Reading.SetCurrentKey("Vehicle No.", "Reading Date");
                Reading.SetRange("Vehicle No.", Vehicle."No.");
                Reading.SetRange("Reading Date", FromDate, ToDate);
                if Reading.FindFirst() then begin
                    FirstKm := Reading.Km;
                    Reading.FindLast();
                    KmDriven := Reading.Km - UsageOpeningKm(Vehicle."No.", FromDate, FirstKm);
                    KmOver := KmDriven - AllowanceKm;
                    if KmOver < 0 then
                        KmOver := 0;

                    if Charge.Get(Vehicle."No.", FromDate) then
                        Charge.Delete();
                    Charge.Init();
                    Charge."Vehicle No." := Vehicle."No.";
                    Charge."Period Start" := FromDate;
                    Charge."Km Driven" := KmDriven;
                    Charge."Km Over" := KmOver;
                    Charge."Band Code" := Statistics.UsageBandOf(KmOver);
                    Charge.Fee := UsageFeeFor(KmOver);
                    Charge.Insert(true);
                    Settled += 1;
                end;
            until Vehicle.Next() = 0;
        exit(Settled);
    end;

    procedure UsageFeeFor(KmOver: Integer): Decimal
    begin
        if KmOver <= 0 then
            exit(0);
        if KmOver > 1500 then
            exit(400);
        exit(150);
    end;

    local procedure UsageOpeningKm(VehicleNo: Code[20]; FromDate: Date; FirstKmInPeriod: Integer): Integer
    var
        Earlier: Record "CGR Usage Reading";
    begin
        Earlier.SetCurrentKey("Vehicle No.", "Reading Date");
        Earlier.SetRange("Vehicle No.", VehicleNo);
        Earlier.SetFilter("Reading Date", '<%1', FromDate);
        if not Earlier.FindLast() then
            exit(FirstKmInPeriod);
        if FromDate - Earlier."Reading Date" <= 400 then
            exit(Earlier.Km);
        exit(FirstKmInPeriod);
    end;
}
