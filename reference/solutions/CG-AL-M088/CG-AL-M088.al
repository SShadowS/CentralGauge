codeunit 70188 "Subscription Engine"
{
    procedure GetNextBillingDate(LastBillingDate: Date; Plan: Enum "Subscription Plan"): Date
    var
        StartingDate: Date;
    begin
        if LastBillingDate = 0D then
            StartingDate := WorkDate()
        else
            StartingDate := LastBillingDate;

        case Plan of
            Plan::Basic:
                exit(CalcDate('<+1M>', StartingDate));
            Plan::Premium:
                exit(CalcDate('<+3M>', StartingDate));
            Plan::Enterprise:
                exit(CalcDate('<+1Y>', StartingDate));
        end;
    end;

    procedure CalculateProratedRefund(TotalAmount: Decimal; DaysUsed: Integer; Plan: Enum "Subscription Plan"): Decimal
    var
        TotalDays: Integer;
        RefundAmount: Decimal;
    begin
        if DaysUsed < 0 then
            exit(0);

        case Plan of
            Plan::Basic:
                TotalDays := 30;
            Plan::Premium:
                TotalDays := 90;
            Plan::Enterprise:
                TotalDays := 365;
        end;

        RefundAmount := (TotalAmount / TotalDays) * (TotalDays - DaysUsed);
        exit(Round(RefundAmount, 0.01));
    end;
}
