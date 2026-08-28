codeunit 89353 "CG-AL-X133 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods (see
    // tests/al/hard/CG-AL-X065.Test.al for the same note), so every test
    // clears the three persisted tables before seeding its own rows. The
    // display row buffer is a temporary record owned by the caller, so it
    // never needs clearing - each test declares its own.

    local procedure ClearAll()
    var
        Assignment: Record "CG X133 Assignment";
        Person: Record "CG X133 Person";
        Team: Record "CG X133 Team";
    begin
        Assignment.DeleteAll();
        Person.DeleteAll();
        Team.DeleteAll();
    end;

    local procedure SeedPerson(PersonCode: Code[20]; DisplayName: Text[100])
    var
        Person: Record "CG X133 Person";
    begin
        Person.Init();
        Person."Code" := PersonCode;
        Person."Display Name" := DisplayName;
        Person.Insert();
    end;

    local procedure SeedTeam(TeamCode: Code[20]; DisplayName: Text[100])
    var
        Team: Record "CG X133 Team";
    begin
        Team.Init();
        Team."Code" := TeamCode;
        Team."Display Name" := DisplayName;
        Team.Insert();
    end;

    local procedure SeedAssignment(AssignmentNo: Code[20]; TeamCode: Code[20]; OwnerCode: Code[20]; AssignmentPriority: Integer)
    var
        Assignment: Record "CG X133 Assignment";
    begin
        Assignment.Init();
        Assignment."No." := AssignmentNo;
        Assignment."Team Code" := TeamCode;
        Assignment."Owner Code" := OwnerCode;
        Assignment.Priority := AssignmentPriority;
        Assignment.Insert();
    end;

    local procedure FlushDataCache()
    begin
        // The warm-up call and the fixture-seeding loop leave the session's
        // data cache warm, and a cache-served read costs zero in the
        // counters below - the graded call would then measure nothing. A
        // write to an unrelated row, followed by SelectLatestVersion, forces
        // real statements again for the measured call.
        SeedAssignment('A-DECOY', 'TEAM-DECOY', 'P-DECOY', 1);
        SelectLatestVersion();
    end;

    local procedure MaxStatements(): Integer
    begin
        exit(20);
    end;

    [Test]
    procedure BuildRowsResolvesOwnerAndTeamDisplayNamesForEachAssignment()
    var
        DisplayRowBuilder: Codeunit "CG X133 Display Row Builder";
        DisplayRow: Record "CG X133 Display Row" temporary;
    begin
        ClearAll();
        SeedTeam('TEAM-1', 'Squad One');
        SeedPerson('P-1', 'Alice Andersen');
        SeedAssignment('A-1', 'TEAM-1', 'P-1', 7);

        DisplayRowBuilder.BuildRows('TEAM-1', DisplayRow);

        DisplayRow.Get('A-1');
        Assert.AreEqual('Alice Andersen', DisplayRow."Owner Display",
            'Expected the assignment row to show the owner''s display name');
        Assert.AreEqual('Squad One', DisplayRow."Team Display",
            'Expected the assignment row to show the team''s display name');
        Assert.AreEqual(7, DisplayRow.Priority,
            'Expected the assignment''s priority to carry through to the row unchanged');
    end;

    [Test]
    procedure BuildRowsGivesEachAssignmentItsOwnOwnersName()
    var
        DisplayRowBuilder: Codeunit "CG X133 Display Row Builder";
        DisplayRow: Record "CG X133 Display Row" temporary;
    begin
        ClearAll();
        SeedTeam('TEAM-2', 'Squad Two');
        SeedPerson('P-2A', 'Bo Berg');
        SeedPerson('P-2B', 'Carla Christensen');
        SeedAssignment('A-2A', 'TEAM-2', 'P-2A', 1);
        SeedAssignment('A-2B', 'TEAM-2', 'P-2B', 1);

        DisplayRowBuilder.BuildRows('TEAM-2', DisplayRow);

        DisplayRow.Get('A-2A');
        Assert.AreEqual('Bo Berg', DisplayRow."Owner Display",
            'Expected this assignment to show its own owner''s name, not a name belonging to another assignment in the same team');
        DisplayRow.Get('A-2B');
        Assert.AreEqual('Carla Christensen', DisplayRow."Owner Display",
            'Expected this assignment to show its own owner''s name, not a name belonging to another assignment in the same team');
    end;

    [Test]
    procedure BuildingTwoTeamsListsKeepsEachInItsOwnBuffer()
    var
        DisplayRowBuilder: Codeunit "CG X133 Display Row Builder";
        DisplayRowA: Record "CG X133 Display Row" temporary;
        DisplayRowB: Record "CG X133 Display Row" temporary;
    begin
        ClearAll();
        SeedTeam('TEAM-3A', 'Squad Three-A');
        SeedTeam('TEAM-3B', 'Squad Three-B');
        SeedPerson('P-3A', 'Dan Dam');
        SeedPerson('P-3B', 'Eva Elm');
        SeedAssignment('A-3A', 'TEAM-3A', 'P-3A', 2);
        SeedAssignment('A-3B', 'TEAM-3B', 'P-3B', 3);

        DisplayRowBuilder.BuildRows('TEAM-3A', DisplayRowA);
        DisplayRowBuilder.BuildRows('TEAM-3B', DisplayRowB);

        Assert.AreEqual(1, DisplayRowA.Count(),
            'Expected team 3A''s own list to contain only its own assignment');
        DisplayRowA.Get('A-3A');
        Assert.AreEqual('Dan Dam', DisplayRowA."Owner Display",
            'Expected team 3A''s list to show its own owner name');
        Assert.IsFalse(DisplayRowA.Get('A-3B'),
            'Expected team 3A''s list to hold only team 3A''s assignments, not team 3B''s');

        Assert.AreEqual(1, DisplayRowB.Count(),
            'Expected team 3B''s own list to contain only its own assignment');
        DisplayRowB.Get('A-3B');
        Assert.AreEqual('Eva Elm', DisplayRowB."Owner Display",
            'Expected team 3B''s list to show its own owner name');
        Assert.IsFalse(DisplayRowB.Get('A-3A'),
            'Expected team 3B''s list to hold only team 3B''s assignments, not team 3A''s');
    end;

    [Test]
    procedure BuildingASecondTeamsListIntoTheSameBufferKeepsTheFirstTeamsRows()
    var
        DisplayRowBuilder: Codeunit "CG X133 Display Row Builder";
        DisplayRow: Record "CG X133 Display Row" temporary;
    begin
        ClearAll();
        SeedTeam('TEAM-7A', 'Squad Seven-A');
        SeedTeam('TEAM-7B', 'Squad Seven-B');
        SeedPerson('P-7A', 'Hans Holm');
        SeedPerson('P-7B', 'Ida Iversen');
        SeedAssignment('A-7A', 'TEAM-7A', 'P-7A', 1);
        SeedAssignment('A-7B', 'TEAM-7B', 'P-7B', 2);

        DisplayRowBuilder.BuildRows('TEAM-7A', DisplayRow);
        DisplayRowBuilder.BuildRows('TEAM-7B', DisplayRow);

        DisplayRow.Reset();
        Assert.AreEqual(2, DisplayRow.Count(),
            'Expected the shared list to hold one row per assignment across both teams after building each team once');
        DisplayRow.Get('A-7A');
        Assert.AreEqual('Hans Holm', DisplayRow."Owner Display",
            'Expected the first team''s row to survive unchanged after building a second team''s list into the same buffer');
    end;

    [Test]
    procedure RebuildingATeamsListReflectsAnAssignmentAddedSinceTheLastBuild()
    var
        DisplayRowBuilder: Codeunit "CG X133 Display Row Builder";
        DisplayRow: Record "CG X133 Display Row" temporary;
    begin
        ClearAll();
        SeedTeam('TEAM-4', 'Squad Four');
        SeedPerson('P-4A', 'Finn Fog');
        SeedPerson('P-4B', 'Gry Green');
        SeedAssignment('A-4A', 'TEAM-4', 'P-4A', 1);

        DisplayRowBuilder.BuildRows('TEAM-4', DisplayRow);
        Assert.AreEqual(1, DisplayRow.Count(),
            'Expected exactly one row after the first build with one assignment');

        SeedAssignment('A-4B', 'TEAM-4', 'P-4B', 1);
        DisplayRowBuilder.BuildRows('TEAM-4', DisplayRow);

        Assert.AreEqual(2, DisplayRow.Count(),
            'Expected the rebuilt list to include the assignment added since the last build');
        DisplayRow.Get('A-4A');
        Assert.AreEqual('Finn Fog', DisplayRow."Owner Display",
            'Expected the earlier assignment''s row to still be correct after a rebuild, not dropped or stale');
        DisplayRow.Get('A-4B');
        Assert.AreEqual('Gry Green', DisplayRow."Owner Display",
            'Expected the newly added assignment to appear with its own owner''s name after a rebuild');
    end;

    [Test]
    procedure BuildRowsLeavesTheDisplayBlankWhenNoMatchingPersonOrTeamExists()
    var
        DisplayRowBuilder: Codeunit "CG X133 Display Row Builder";
        DisplayRow: Record "CG X133 Display Row" temporary;
    begin
        ClearAll();
        // Deliberately no "CG X133 Team" row for 'TEAM-5' and no
        // "CG X133 Person" row for 'P-5' - the assignment references master
        // data that does not exist.
        SeedAssignment('A-5', 'TEAM-5', 'P-5', 9);

        DisplayRowBuilder.BuildRows('TEAM-5', DisplayRow);

        DisplayRow.Get('A-5');
        Assert.AreEqual('', DisplayRow."Owner Display",
            'Expected a blank owner display, not an error, when the owner code matches no person');
        Assert.AreEqual('', DisplayRow."Team Display",
            'Expected a blank team display, not an error, when the team code matches no team');
        Assert.AreEqual(9, DisplayRow.Priority,
            'Expected the priority to still carry through even when neither related name resolves');
    end;

    [Test]
    procedure BuildRowsProducesNoRowsForATeamWithNoAssignments()
    var
        DisplayRowBuilder: Codeunit "CG X133 Display Row Builder";
        DisplayRow: Record "CG X133 Display Row" temporary;
    begin
        ClearAll();
        SeedTeam('TEAM-6', 'Squad Six');

        DisplayRowBuilder.BuildRows('TEAM-6', DisplayRow);

        Assert.AreEqual(0, DisplayRow.Count(),
            'Expected no rows for a team with no assignments at all - and no error either');
    end;

    [Test]
    procedure BuildingALargeTeamsListCostsTheSameAsASmallOnes()
    var
        DisplayRowBuilder: Codeunit "CG X133 Display Row Builder";
        WarmDisplayRow: Record "CG X133 Display Row" temporary;
        DisplayRow: Record "CG X133 Display Row" temporary;
        StatementsBefore: BigInteger;
        StatementsUsed: BigInteger;
        OwnerCode: Code[20];
        AssignmentNo: Code[20];
        i: Integer;
        AssignmentCount: Integer;
    begin
        ClearAll();
        AssignmentCount := 300;

        // Warm up on an unrelated, single-assignment team first, so
        // first-touch metadata/plan loading lands outside the measurement
        // window below.
        SeedTeam('TEAM-WARM', 'Warm Squad');
        SeedPerson('P-WARM', 'Warm Owner');
        SeedAssignment('A-WARM', 'TEAM-WARM', 'P-WARM', 1);
        DisplayRowBuilder.BuildRows('TEAM-WARM', WarmDisplayRow);
        ClearAll();

        // A large team: 300 assignments, each with its own distinct owner -
        // a busy team's list, versus the one-assignment team measured above.
        SeedTeam('TEAM-BUSY', 'Busy Squad');
        for i := 1 to AssignmentCount do begin
            OwnerCode := CopyStr(StrSubstNo('P-BUSY-%1', i), 1, MaxStrLen(OwnerCode));
            AssignmentNo := CopyStr(StrSubstNo('A-BUSY-%1', i), 1, MaxStrLen(AssignmentNo));
            SeedPerson(OwnerCode, CopyStr(StrSubstNo('Owner %1 Name', i), 1, 100));
            SeedAssignment(AssignmentNo, 'TEAM-BUSY', OwnerCode, i);
        end;

        FlushDataCache();
        StatementsBefore := SessionInformation.SqlStatementsExecuted();
        DisplayRowBuilder.BuildRows('TEAM-BUSY', DisplayRow);
        StatementsUsed := SessionInformation.SqlStatementsExecuted() - StatementsBefore;

        DisplayRow.Get('A-BUSY-1');
        Assert.AreEqual('Owner 1 Name', DisplayRow."Owner Display",
            'Expected the correct owner name on the low-cost build before judging its cost');
        DisplayRow.Get('A-BUSY-300');
        Assert.AreEqual('Owner 300 Name', DisplayRow."Owner Display",
            'Expected the correct owner name on the low-cost build before judging its cost - including the last assignment in a large team');
        Assert.AreEqual('Busy Squad', DisplayRow."Team Display",
            'Expected the correct team name on the low-cost build before judging its cost');
        Assert.IsTrue(StatementsUsed <= MaxStatements(),
            StrSubstNo('Expected building a large team''s list to cost the same as a small one: budget %1, actual %2 against %3 assignments', MaxStatements(), StatementsUsed, AssignmentCount));
    end;
}
