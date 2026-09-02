codeunit 71413 "CG X157 Period Statement"
{
    procedure GetPeriodAmount(CostCenterCode: Code[20]; FromDate: Date; ToDate: Date): Decimal
    var
        CostCenter: Record "CG X157 Cost Center";
    begin
        if not CostCenter.Get(CostCenterCode) then
            exit(0);

        CostCenter.SetRange("Date Filter", FromDate, ToDate);
        CostCenter.CalcFields("Net Change");
        exit(CostCenter."Net Change");
    end;

    procedure BuildStatement(CostCenterCode: Code[20]; FromDate: Date; ToDate: Date)
    var
        StatementLine: Record "CG X157 Statement Line";
        PeriodStart: Date;
        PeriodEnd: Date;
    begin
        StatementLine.SetRange("Cost Center Code", CostCenterCode);
        StatementLine.DeleteAll();

        PeriodStart := FromDate;
        while PeriodStart <= ToDate do begin
            PeriodEnd := EndOfMonth(PeriodStart);
            if PeriodEnd > ToDate then
                PeriodEnd := ToDate;

            StatementLine.Init();
            StatementLine."Cost Center Code" := CostCenterCode;
            StatementLine."Period Start" := PeriodStart;
            StatementLine.Amount := GetPeriodAmount(CostCenterCode, PeriodStart, PeriodEnd);
            StatementLine.Insert();

            PeriodStart := PeriodEnd + 1;
        end;
    end;

    local procedure EndOfMonth(D: Date): Date
    var
        Month: Integer;
        Year: Integer;
        NextMonth: Integer;
        NextYear: Integer;
    begin
        Month := Date2DMY(D, 2);
        Year := Date2DMY(D, 3);

        if Month = 12 then begin
            NextMonth := 1;
            NextYear := Year + 1;
        end else begin
            NextMonth := Month + 1;
            NextYear := Year;
        end;

        exit(DMY2Date(1, NextMonth, NextYear) - 1);
    end;
}
