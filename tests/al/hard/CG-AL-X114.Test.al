codeunit 89308 "CG-AL-X114 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every record-driven test
    // clears the table before seeding its own rows. Untouched claims are
    // seeded with a nonzero sentinel amount so "untouched" and
    // "recalculated to zero" stay distinguishable.

    local procedure Seed(EntryNo: Integer; AwayMinutes: Integer; InitialAmount: Integer)
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.Init();
        Claim."Entry No." := EntryNo;
        Claim."Away Minutes" := AwayMinutes;
        Claim."Allowance Amount" := InitialAmount;
        Claim.Insert();
    end;

    local procedure Recalc(EntryNo: Integer)
    var
        Claim: Record "CG X114 Travel Claim";
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
    begin
        Claim.Get(EntryNo);
        AllowanceCalc.RecalculateClaim(Claim);
    end;

    local procedure AmountOf(EntryNo: Integer): Integer
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.Get(EntryNo);
        exit(Claim."Allowance Amount");
    end;

    // Independent reference ladder the sweeps below grade against -
    // deliberately not shared with the application code under test.
    local procedure ExpectedAmountFor(AwayMinutes: Integer): Integer
    begin
        if AwayMinutes >= 720 then
            exit(500);
        if AwayMinutes > 360 then
            exit(250);
        exit(0);
    end;

    [Test]
    procedure CalculatedAmountsMatchTheConfirmedBandNearSixHours()
    var
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
        AwayMinutes: Integer;
    begin
        for AwayMinutes := 350 to 370 do
            Assert.AreEqual(
              ExpectedAmountFor(AwayMinutes),
              AllowanceCalc.CalculateAllowance(AwayMinutes),
              'The allowance amount must match the confirmed band for every away-time in this range');
    end;

    [Test]
    procedure CalculatedAmountsMatchTheConfirmedBandNearTwelveHours()
    var
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
        AwayMinutes: Integer;
    begin
        for AwayMinutes := 710 to 730 do
            Assert.AreEqual(
              ExpectedAmountFor(AwayMinutes),
              AllowanceCalc.CalculateAllowance(AwayMinutes),
              'The allowance amount must match the confirmed band for every away-time in this range');
    end;

    [Test]
    procedure TheShortestAndLongestTripsResolveToTheOuterTiers()
    var
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
    begin
        Assert.AreEqual(0, AllowanceCalc.CalculateAllowance(-30), 'A negative away-time must resolve to no allowance');
        Assert.AreEqual(0, AllowanceCalc.CalculateAllowance(0), 'A zero-minute trip must resolve to no allowance');
        Assert.AreEqual(0, AllowanceCalc.CalculateAllowance(1), 'A 1-minute trip must resolve to no allowance');
        Assert.AreEqual(500, AllowanceCalc.CalculateAllowance(1440), 'A 1440-minute trip must resolve to the full allowance');
    end;

    [Test]
    procedure TheOvertimeBandClassificationStaysCorrect()
    var
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
    begin
        Assert.AreEqual(0, AllowanceCalc.OvertimeBandOf(200), 'A 200-minute trip must classify into the no-allowance band');
        Assert.AreEqual(1, AllowanceCalc.OvertimeBandOf(500), 'A 500-minute trip must classify into the partial-allowance band');
        Assert.AreEqual(2, AllowanceCalc.OvertimeBandOf(800), 'An 800-minute trip must classify into the full-allowance band');

        // The statistics classification must keep matching the confirmed
        // amount schedule at the same away-times CalculateAllowance is
        // graded on - a rewrite that simplifies away how OvertimeBandOf
        // decides each side of these away-times must not go ungraded.
        Assert.AreEqual(0, AllowanceCalc.OvertimeBandOf(359), 'A 359-minute trip must classify into the no-allowance band');
        Assert.AreEqual(0, AllowanceCalc.OvertimeBandOf(360), 'A 360-minute trip must classify into the no-allowance band');
        Assert.AreEqual(1, AllowanceCalc.OvertimeBandOf(361), 'A 361-minute trip must classify into the partial-allowance band');
        Assert.AreEqual(1, AllowanceCalc.OvertimeBandOf(719), 'A 719-minute trip must classify into the partial-allowance band');
        Assert.AreEqual(2, AllowanceCalc.OvertimeBandOf(720), 'A 720-minute trip must classify into the full-allowance band');
        Assert.AreEqual(2, AllowanceCalc.OvertimeBandOf(721), 'A 721-minute trip must classify into the full-allowance band');
    end;

    [Test]
    procedure RecalculatingAClaimWritesTheConfirmedAmountBackToTheRecord()
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.DeleteAll();
        Seed(1, 500, 999);

        Recalc(1);

        Assert.AreEqual(250, AmountOf(1), 'Recalculating a claim must store the confirmed allowance amount back onto the claim');
    end;

    [Test]
    procedure RecalculatingOneClaimLeavesOtherClaimsUntouched()
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.DeleteAll();
        Seed(2, 500, 999);
        Seed(3, 800, 777);

        Recalc(2);

        Assert.AreEqual(250, AmountOf(2), 'The recalculated claim must resolve to the confirmed allowance amount');
        Assert.AreEqual(777, AmountOf(3), 'A claim that was not recalculated must keep its existing allowance amount');
    end;

    [Test]
    procedure RecalculatingTheSameClaimTwiceIsStable()
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.DeleteAll();
        Seed(4, 500, 0);

        Recalc(4);
        Recalc(4);

        Assert.AreEqual(250, AmountOf(4), 'Recalculating the same claim twice must not change the result');
    end;
}
