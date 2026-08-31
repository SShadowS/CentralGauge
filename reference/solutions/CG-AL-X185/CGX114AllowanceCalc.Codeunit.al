codeunit 70741 "CG X114 Allowance Calc"
{
    procedure CalculateAllowance(AwayMinutes: Integer): Integer
    begin
        if AwayMinutes >= 720 then
            exit(500);
        if AwayMinutes > 360 then
            exit(250);
        exit(0);
    end;

    procedure RecalculateClaim(var Claim: Record "CG X114 Travel Claim")
    begin
        Claim."Allowance Amount" := CalculateAllowance(Claim."Away Minutes");
        Claim.Modify();
    end;

    // Feeds the away-time statistics report, which classifies every claim
    // into the same three bands CalculateAllowance pays out on: 0 = no
    // allowance, 1 = partial allowance, 2 = full allowance.
    procedure OvertimeBandOf(AwayMinutes: Integer): Integer
    begin
        if BandMatches(AwayMinutes, 720, false) then
            exit(2);
        if BandMatches(AwayMinutes, 360, true) then
            exit(1);
        exit(0);
    end;

    local procedure BandMatches(AwayMinutes: Integer; ThresholdMinutes: Integer; Exclusive: Boolean): Boolean
    begin
        if Exclusive then
            exit(AwayMinutes > ThresholdMinutes);
        exit(AwayMinutes >= ThresholdMinutes);
    end;
}
