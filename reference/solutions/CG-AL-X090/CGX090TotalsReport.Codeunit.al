codeunit 70553 "CG X090 Totals Report"
{
    procedure TotalsByTeam(TeamFilter: Text): Dictionary of [Code[20], Decimal]
    var
        TeamTotals: Query "CG X090 Team Totals";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        TeamTotals.SetFilter(AssignedTeam, TeamFilter);
        TeamTotals.Open();
        while TeamTotals.Read() do
            Totals.Add(TeamTotals.AssignedTeam, TeamTotals.TotalAmount);
        exit(Totals);
    end;
}
