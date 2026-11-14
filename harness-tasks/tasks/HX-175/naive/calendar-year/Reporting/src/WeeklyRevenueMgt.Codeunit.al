codeunit 70577 "CGR Weekly Revenue Mgt"
{
    procedure BuildWeekRevenue(VehicleNo: Code[20])
    var
        WeekRevenue: Record "CGR Vehicle Week Revenue";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        WeekYear: Integer;
        WeekNo: Integer;
    begin
        WeekRevenue.SetRange("Vehicle No.", VehicleNo);
        WeekRevenue.DeleteAll();

        LedgerEntry.SetRange("Vehicle No.", VehicleNo);
        if LedgerEntry.FindSet() then
            repeat
                WeekNo := Date2DWY(LedgerEntry."Posting Date", 2);
                WeekYear := Date2DMY(LedgerEntry."Posting Date", 3);
                if not WeekRevenue.Get(VehicleNo, WeekYear, WeekNo) then begin
                    WeekRevenue.Init();
                    WeekRevenue."Vehicle No." := VehicleNo;
                    WeekRevenue.Year := WeekYear;
                    WeekRevenue."Week No." := WeekNo;
                    WeekRevenue."Week Start" := LedgerEntry."Posting Date" - Date2DWY(LedgerEntry."Posting Date", 1) + 1;
                    WeekRevenue.Insert();
                end;
                WeekRevenue.Amount += LedgerEntry.Amount;
                WeekRevenue."Entry Count" += 1;
                WeekRevenue.Modify();
            until LedgerEntry.Next() = 0;
    end;

    procedure GetYearWeeks(VehicleNo: Code[20]; Year: Integer; var WeekBuffer: Record "CGR Vehicle Week Revenue" temporary)
    var
        WeekRevenue: Record "CGR Vehicle Week Revenue";
        WeekCount: Integer;
        WeekNo: Integer;
    begin
        WeekCount := Date2DWY(DMY2Date(31, 12, Year), 2);
        for WeekNo := 1 to WeekCount do begin
            WeekBuffer.Init();
            WeekBuffer."Vehicle No." := VehicleNo;
            WeekBuffer.Year := Year;
            WeekBuffer."Week No." := WeekNo;
            WeekBuffer."Week Start" := DWY2Date(1, WeekNo, Year);
            if WeekRevenue.Get(VehicleNo, Year, WeekNo) then begin
                WeekBuffer.Amount := WeekRevenue.Amount;
                WeekBuffer."Entry Count" := WeekRevenue."Entry Count";
            end;
            WeekBuffer.Insert();
        end;
    end;
}
