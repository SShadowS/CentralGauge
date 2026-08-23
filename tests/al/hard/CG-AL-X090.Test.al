codeunit 89087 "CG-AL-X090 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods (see
    // tests/al/hard/CG-AL-X065.Test.al for the same note), so every test
    // clears both tables before seeding its own rows.

    local procedure ClearAll()
    var
        CaseRec: Record "CG X090 Case";
        Adjustment: Record "CG X090 Adjustment";
    begin
        Adjustment.DeleteAll();
        CaseRec.DeleteAll();
    end;

    local procedure CreateCase(CaseNo: Code[20]; TeamCode: Code[20])
    var
        CaseRec: Record "CG X090 Case";
    begin
        CaseRec.Init();
        CaseRec."No." := CaseNo;
        CaseRec."Assigned Team" := TeamCode;
        CaseRec.Description := 'Seed';
        CaseRec.Insert();
    end;

    local procedure AddAdjustment(CaseNo: Code[20]; StampedTeamCode: Code[20]; AdjAmount: Decimal)
    var
        Adjustment: Record "CG X090 Adjustment";
    begin
        Adjustment.Init();
        Adjustment."Case No." := CaseNo;
        Adjustment."Team Code" := StampedTeamCode;
        Adjustment.Amount := AdjAmount;
        Adjustment.Insert(true);
    end;

    local procedure GetTotal(Totals: Dictionary of [Code[20], Decimal]; TeamCode: Code[20]): Decimal
    begin
        Assert.IsTrue(Totals.ContainsKey(TeamCode), StrSubstNo('Expected team %1 to appear in the report', TeamCode));
        exit(Totals.Get(TeamCode));
    end;

    [Test]
    procedure SumsAdjustmentsAcrossAllCasesOfOneTeam()
    var
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateCase('C1', 'TEAM-A');
        CreateCase('C2', 'TEAM-A');
        AddAdjustment('C1', 'TEAM-A', 100);
        AddAdjustment('C1', 'TEAM-A', 50);
        AddAdjustment('C2', 'TEAM-A', 25);

        Totals := TotalsReport.TotalsByTeam('TEAM-A');

        Assert.AreEqual(175, GetTotal(Totals, 'TEAM-A'),
            'Expected the team''s total to add up every adjustment of every case assigned to it');
    end;

    [Test]
    procedure KeepsEachTeamsTotalSeparate()
    var
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateCase('C1', 'TEAM-B1');
        CreateCase('C2', 'TEAM-B2');
        AddAdjustment('C1', 'TEAM-B1', 60);
        AddAdjustment('C2', 'TEAM-B2', 90);

        Totals := TotalsReport.TotalsByTeam('TEAM-B*');

        Assert.AreEqual(60, GetTotal(Totals, 'TEAM-B1'),
            'Expected team B1''s total to contain only adjustments of B1''s own cases');
        Assert.AreEqual(90, GetTotal(Totals, 'TEAM-B2'),
            'Expected team B2''s total to contain only adjustments of B2''s own cases');
    end;

    [Test]
    procedure NegativeAdjustmentsReduceTheTotal()
    var
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateCase('C1', 'TEAM-C');
        AddAdjustment('C1', 'TEAM-C', 500);
        AddAdjustment('C1', 'TEAM-C', -120);

        Totals := TotalsReport.TotalsByTeam('TEAM-C');

        Assert.AreEqual(380, GetTotal(Totals, 'TEAM-C'),
            'Expected a negative adjustment to reduce the team''s total, not be skipped');
    end;

    [Test]
    procedure CaseWithNoAdjustmentsAppearsWithZero()
    var
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateCase('C1', 'TEAM-D');

        Totals := TotalsReport.TotalsByTeam('TEAM-D');

        Assert.IsTrue(Totals.ContainsKey('TEAM-D'),
            'Expected the team to stay in the report even though its case has no adjustments at all');
        Assert.AreEqual(0, GetTotal(Totals, 'TEAM-D'),
            'Expected a total of exactly 0 for a team whose case has no adjustments');
    end;

    [Test]
    procedure GroupsByTheCasesCurrentTeamNotTheAdjustmentStamp()
    var
        CaseRec: Record "CG X090 Case";
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateCase('C1', 'TEAM-E1');
        CreateCase('C2', 'TEAM-E2');
        // The adjustment on C1 is stamped with a different team than C1's own
        // current assignment - the stamp must be ignored in favor of the case.
        AddAdjustment('C1', 'TEAM-E2', 300);

        // C3 starts on TEAM-E2 with its stamp matching that team at the time
        // the adjustment was recorded, then gets reassigned afterward - a
        // total computed once at recording time and never revisited would
        // still show it under TEAM-E2.
        CreateCase('C3', 'TEAM-E2');
        AddAdjustment('C3', 'TEAM-E2', 300);
        CaseRec.Get('C3');
        CaseRec."Assigned Team" := 'TEAM-E1';
        CaseRec.Modify();

        Totals := TotalsReport.TotalsByTeam('TEAM-E*');

        Assert.AreEqual(600, GetTotal(Totals, 'TEAM-E1'),
            'Expected the amount under the team each case is currently assigned to - both the adjustment whose own stamp points elsewhere, and the case reassigned after its adjustment was recorded, must be ignored in favor of the case''s current team');
        Assert.AreEqual(0, GetTotal(Totals, 'TEAM-E2'),
            'Expected 0 for the team neither case is currently assigned to - a stale stamp or a team a case was reassigned away from must not attract the amount');
    end;

    [Test]
    procedure CasesOutsideTheFilterAreNotCounted()
    var
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateCase('C1', 'TEAM-F1');
        CreateCase('C2', 'TEAM-F2');
        AddAdjustment('C1', 'TEAM-F1', 40);
        AddAdjustment('C2', 'TEAM-F2', 999);

        Totals := TotalsReport.TotalsByTeam('TEAM-F1');

        Assert.AreEqual(1, Totals.Count(),
            'Expected only the team matching the filter to appear in the report');
        Assert.AreEqual(40, GetTotal(Totals, 'TEAM-F1'),
            'Expected the total to be built only from cases inside the filter');
    end;

    [Test]
    procedure EveryTeamAppearsExactlyOnce()
    var
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
        TeamCode: Code[20];
        i: Integer;
    begin
        ClearAll();
        for i := 1 to 6 do begin
            TeamCode := CopyStr(StrSubstNo('TEAM-G%1', i), 1, MaxStrLen(TeamCode));
            CreateCase(CopyStr(StrSubstNo('C%1A', i), 1, 20), TeamCode);
            CreateCase(CopyStr(StrSubstNo('C%1B', i), 1, 20), TeamCode);
            AddAdjustment(CopyStr(StrSubstNo('C%1A', i), 1, 20), TeamCode, 10);
            AddAdjustment(CopyStr(StrSubstNo('C%1B', i), 1, 20), TeamCode, 10);
        end;

        Totals := TotalsReport.TotalsByTeam('TEAM-G*');

        Assert.AreEqual(6, Totals.Count(),
            'Expected exactly one row per team - 6 teams were seeded, each with two cases');
        for i := 1 to 6 do begin
            TeamCode := CopyStr(StrSubstNo('TEAM-G%1', i), 1, MaxStrLen(TeamCode));
            Assert.AreEqual(20, GetTotal(Totals, TeamCode),
                StrSubstNo('Expected team %1 to appear with the sum of both of its cases', TeamCode));
        end;
    end;

    [Test]
    procedure ReturnsEmptyWhenNoCaseMatches()
    var
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateCase('C1', 'TEAM-H');

        Totals := TotalsReport.TotalsByTeam('TEAM-NOMATCH');

        Assert.AreEqual(0, Totals.Count(),
            'Expected an empty report when no case matches the filter');
    end;

    [Test]
    procedure RepeatedCallsReflectAdjustmentsAddedInBetween()
    var
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateCase('C1', 'TEAM-I');
        AddAdjustment('C1', 'TEAM-I', 100);

        Totals := TotalsReport.TotalsByTeam('TEAM-I');
        Assert.AreEqual(100, GetTotal(Totals, 'TEAM-I'),
            'Expected the first call to reflect the one adjustment recorded so far');

        AddAdjustment('C1', 'TEAM-I', 50);
        Totals := TotalsReport.TotalsByTeam('TEAM-I');
        Assert.AreEqual(150, GetTotal(Totals, 'TEAM-I'),
            'Expected a second call with the same filter to include an adjustment recorded after the first call, not repeat the first call''s total');
    end;

    [Test]
    procedure TotalsCostDoesNotScaleWithCaseCount()
    var
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        RowsBefore: BigInteger;
        RowsAfter: BigInteger;
        StmtDelta: BigInteger;
        RowsDelta: BigInteger;
        TeamCode: Code[20];
        CaseNo: Code[20];
        TeamIndex: Integer;
        CaseIndex: Integer;
    begin
        ClearAll();

        // Warm-up: exercise the report once on a small, unrelated team so
        // first-touch metadata/plan loading lands outside the measurement
        // window below.
        CreateCase('WARM', 'TEAM-WARM');
        AddAdjustment('WARM', 'TEAM-WARM', 1);
        TotalsReport.TotalsByTeam('TEAM-WARM');
        ClearAll();

        // 10 teams with 20 cases each (200 cases total, one adjustment per
        // case) - a backlog that must be answered without visiting each
        // matching case's adjustments one at a time.
        for TeamIndex := 1 to 10 do begin
            TeamCode := CopyStr(StrSubstNo('TEAM-P%1', TeamIndex), 1, MaxStrLen(TeamCode));
            for CaseIndex := 1 to 20 do begin
                CaseNo := CopyStr(StrSubstNo('P%1-%2', TeamIndex, CaseIndex), 1, MaxStrLen(CaseNo));
                CreateCase(CaseNo, TeamCode);
                AddAdjustment(CaseNo, TeamCode, 10);
            end;
        end;

        StmtBefore := SessionInformation.SqlStatementsExecuted;
        RowsBefore := SessionInformation.SqlRowsRead;

        Totals := TotalsReport.TotalsByTeam('TEAM-P*');

        StmtAfter := SessionInformation.SqlStatementsExecuted;
        RowsAfter := SessionInformation.SqlRowsRead;
        StmtDelta := StmtAfter - StmtBefore;
        RowsDelta := RowsAfter - RowsBefore;

        Assert.AreEqual(10, Totals.Count(),
            'Expected every one of the 10 teams in the report before judging the cost');
        Assert.AreEqual(200, GetTotal(Totals, 'TEAM-P1'),
            'Expected the low-cost report to still carry the real sums - 20 cases of 10 each for team P1');
        Assert.IsTrue(
            StmtDelta <= 20,
            StrSubstNo('The report must not do work proportional to how many cases match: statement budget %1, actual %2', 20, StmtDelta));
        Assert.IsTrue(
            RowsDelta <= 20,
            StrSubstNo('The report must not do work proportional to how many cases match: rows budget %1, actual %2', 20, RowsDelta));
    end;
}
