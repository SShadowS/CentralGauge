codeunit 70553 "CG X090 Totals Report"
{
    procedure TotalsByTeam(TeamFilter: Text): Dictionary of [Code[20], Decimal]
    var
        CaseRec: Record "CG X090 Case";
        Adjustment: Record "CG X090 Adjustment";
        Totals: Dictionary of [Code[20], Decimal];
        Total: Decimal;
    begin
        CaseRec.SetFilter("Assigned Team", TeamFilter);
        if CaseRec.FindSet() then
            repeat
                Total := 0;
                Adjustment.SetRange("Case No.", CaseRec."No.");
                if Adjustment.FindSet() then
                    repeat
                        Total += Adjustment.Amount;
                    until Adjustment.Next() = 0;
                if Totals.ContainsKey(CaseRec."Assigned Team") then
                    Totals.Set(CaseRec."Assigned Team", Totals.Get(CaseRec."Assigned Team") + Total)
                else
                    Totals.Add(CaseRec."Assigned Team", Total);
            until CaseRec.Next() = 0;
        exit(Totals);
    end;
}
