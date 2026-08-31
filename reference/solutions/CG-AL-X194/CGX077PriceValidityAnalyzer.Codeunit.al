codeunit 70421 "CG X077 Validity Analyzer"
{
    var
        EndingBeforeStartingErr: Label 'Line %1 is invalid: the ending date %2 is before the starting date %3.', Comment = '%1 = line no., %2 = ending date, %3 = starting date';

    procedure MergeValidityPeriods(var PriceLine: Record "CG X077 Price Validity Line" temporary; var MergedPeriod: Record "CG X077 Price Validity Line" temporary)
    var
        CurrStart: Date;
        CurrEnd: Date;
        CurrOpenEnded: Boolean;
        NextLineNo: Integer;
        JoinsCurrentPeriod: Boolean;
    begin
        ValidateLines(PriceLine);

        MergedPeriod.Reset();
        MergedPeriod.DeleteAll();

        PriceLine.Reset();
        PriceLine.SetCurrentKey("Starting Date");
        if not PriceLine.FindSet() then
            exit;

        CurrStart := PriceLine."Starting Date";
        CurrEnd := PriceLine."Ending Date";
        CurrOpenEnded := PriceLine."Ending Date" = 0D;

        while PriceLine.Next() <> 0 do begin
            // An open-ended current period absorbs every later line.
            if CurrOpenEnded then
                JoinsCurrentPeriod := true
            else
                JoinsCurrentPeriod := PriceLine."Starting Date" <= CurrEnd + 1;

            if JoinsCurrentPeriod then begin
                if PriceLine."Ending Date" = 0D then
                    CurrOpenEnded := true
                else
                    if (not CurrOpenEnded) and (PriceLine."Ending Date" > CurrEnd) then
                        CurrEnd := PriceLine."Ending Date";
            end else begin
                EmitPeriod(MergedPeriod, NextLineNo, CurrStart, CurrEnd, CurrOpenEnded);
                CurrStart := PriceLine."Starting Date";
                CurrEnd := PriceLine."Ending Date";
                CurrOpenEnded := PriceLine."Ending Date" = 0D;
            end;
        end;

        EmitPeriod(MergedPeriod, NextLineNo, CurrStart, CurrEnd, CurrOpenEnded);
    end;

    procedure CountConflictingPairs(var PriceLine: Record "CG X077 Price Validity Line" temporary): Integer
    var
        Starts: List of [Date];
        Ends: List of [Date];
        Pairs: Integer;
        i: Integer;
        j: Integer;
    begin
        ValidateLines(PriceLine);

        PriceLine.Reset();
        if PriceLine.FindSet() then
            repeat
                Starts.Add(PriceLine."Starting Date");
                Ends.Add(PriceLine."Ending Date");
            until PriceLine.Next() = 0;

        for i := 1 to Starts.Count - 1 do
            for j := i + 1 to Starts.Count do
                if PeriodsOverlap(Starts.Get(i), Ends.Get(i), Starts.Get(j), Ends.Get(j)) then
                    Pairs += 1;

        exit(Pairs);
    end;

    local procedure PeriodsOverlap(StartA: Date; EndA: Date; StartB: Date; EndB: Date): Boolean
    begin
        exit(((EndA = 0D) or (StartB <= EndA)) and ((EndB = 0D) or (StartA <= EndB)));
    end;

    local procedure EmitPeriod(var MergedPeriod: Record "CG X077 Price Validity Line" temporary; var NextLineNo: Integer; StartDate: Date; EndDate: Date; OpenEnded: Boolean)
    begin
        NextLineNo += 10000;
        MergedPeriod.Init();
        MergedPeriod."Line No." := NextLineNo;
        MergedPeriod."Starting Date" := StartDate;
        if OpenEnded then
            MergedPeriod."Ending Date" := 0D
        else
            MergedPeriod."Ending Date" := EndDate;
        MergedPeriod.Insert();
    end;

    local procedure ValidateLines(var PriceLine: Record "CG X077 Price Validity Line" temporary)
    begin
        PriceLine.Reset();
        if PriceLine.FindSet() then
            repeat
                if (PriceLine."Starting Date" <> 0D) and (PriceLine."Ending Date" <> 0D) and
                   (PriceLine."Ending Date" < PriceLine."Starting Date")
                then
                    Error(EndingBeforeStartingErr, PriceLine."Line No.", PriceLine."Ending Date", PriceLine."Starting Date");
            until PriceLine.Next() = 0;
    end;
}
