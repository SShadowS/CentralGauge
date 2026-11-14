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
                WeekYear := Date2DWY(LedgerEntry."Posting Date", 3);
                if not WeekRevenue.Get(VehicleNo, WeekYear, WeekNo) then begin
                    WeekRevenue.Init();
                    WeekRevenue."Vehicle No." := VehicleNo;
                    WeekRevenue.Year := WeekYear;
                    WeekRevenue."Week No." := WeekNo;
                    WeekRevenue."Week Start" := DWY2Date(1, WeekNo, WeekYear);
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
        WeekStart: Date;
        WeekNo: Integer;
    begin
        for WeekNo := 1 to 53 do begin
            WeekStart := DWY2Date(1, WeekNo, Year);
            if Date2DWY(WeekStart, 3) <> Year then
                break;
            WeekBuffer.Init();
            WeekBuffer."Vehicle No." := VehicleNo;
            WeekBuffer.Year := Year;
            WeekBuffer."Week No." := WeekNo;
            WeekBuffer."Week Start" := WeekStart;
            if WeekRevenue.Get(VehicleNo, Year, WeekNo) then begin
                WeekBuffer.Amount := WeekRevenue.Amount;
                WeekBuffer."Entry Count" := WeekRevenue."Entry Count";
            end;
            WeekBuffer.Insert();
        end;
    end;
}
