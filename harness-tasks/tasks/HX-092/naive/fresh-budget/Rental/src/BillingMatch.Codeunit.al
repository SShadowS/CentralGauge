codeunit 70243 "CGR Billing Match"
{
    procedure OpenDays(BillingLineNo: Integer): Decimal
    var
        BillingLine: Record "CGR Billing Line";
        DayLine: Record "CGR Contract Day Line";
    begin
        BillingLine.Get(BillingLineNo);
        DayLine.SetRange("Billing Line No.", BillingLineNo);
        DayLine.CalcSums("Matched Days");
        exit(BillingLine.Days - DayLine."Matched Days");
    end;

    procedure MatchLines(BillingLineNo: Integer; var DayLines: Record "CGR Contract Day Line")
    var
        BillingLine: Record "CGR Billing Line";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        Budget: Decimal;
    begin
        DayLines.SetCurrentKey("Contract No.", "Line No.");
        if not DayLines.FindSet() then
            exit;
        if DayLines.Count() = 1 then begin
            MatchSingle(BillingLineNo, DayLines);
            exit;
        end;
        // Budget starts from the billing line's days, so lines already linked outside the selection are not counted.
        BillingLine.Get(BillingLineNo);
        Budget := BillingLine.Days;
        repeat
            DayLines."Matched Days" := DayLines.Days;
            if (FleetMgt.SubstituteFor(DayLines."Vehicle No.") = DayLines."Vehicle No.") and (DayLines.Days <= Budget) then begin
                DayLines."Billing Line No." := BillingLineNo;
                Budget -= DayLines.Days;
            end else
                DayLines."Billing Line No." := 0;
            DayLines.Modify();
        until DayLines.Next() = 0;
    end;

    local procedure MatchSingle(BillingLineNo: Integer; var DayLine: Record "CGR Contract Day Line")
    var
        Open: Decimal;
    begin
        Open := OpenDays(BillingLineNo);
        if DayLine."Billing Line No." = BillingLineNo then
            Open += DayLine."Matched Days";
        if Open < 0 then
            Open := 0;
        if DayLine.Days < Open then
            DayLine."Matched Days" := DayLine.Days
        else
            DayLine."Matched Days" := Open;
        DayLine."Billing Line No." := BillingLineNo;
        DayLine.Modify();
    end;
}
