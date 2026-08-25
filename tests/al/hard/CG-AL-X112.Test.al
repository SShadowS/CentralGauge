codeunit 89306 "CG-AL-X112 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (see tests/al/hard/CG-AL-X065.Test.al for the same note), so every
    // test clears both tables before seeding its own rows.

    local procedure ClearAll()
    var
        Agreement: Record "CG X112 Job Agreement";
        StatusEntry: Record "CG X112 Status Entry";
    begin
        StatusEntry.DeleteAll();
        Agreement.DeleteAll();
    end;

    local procedure SeedAgreement(No: Code[20]; Desc: Text[100])
    var
        Agreement: Record "CG X112 Job Agreement";
    begin
        Agreement.Init();
        Agreement."No." := No;
        Agreement.Description := Desc;
        Agreement.Insert(true);
    end;

    local procedure SeedInfoEntry(AgreementNo: Code[20]; EntryDate: Date; Resolved: Boolean; Msg: Text[100])
    var
        StatusEntry: Record "CG X112 Status Entry";
    begin
        StatusEntry.Init();
        StatusEntry."Agreement No." := AgreementNo;
        StatusEntry."Entry Date" := EntryDate;
        StatusEntry.Severity := StatusEntry.Severity::Info;
        StatusEntry.Resolved := Resolved;
        StatusEntry.Message := Msg;
        StatusEntry.Insert(true);
    end;

    local procedure SeedWarningEntry(AgreementNo: Code[20]; EntryDate: Date; Resolved: Boolean; Msg: Text[100])
    var
        StatusEntry: Record "CG X112 Status Entry";
    begin
        StatusEntry.Init();
        StatusEntry."Agreement No." := AgreementNo;
        StatusEntry."Entry Date" := EntryDate;
        StatusEntry.Severity := StatusEntry.Severity::Warning;
        StatusEntry.Resolved := Resolved;
        StatusEntry.Message := Msg;
        StatusEntry.Insert(true);
    end;

    local procedure SeedErrorEntry(AgreementNo: Code[20]; EntryDate: Date; Resolved: Boolean; Msg: Text[100])
    var
        StatusEntry: Record "CG X112 Status Entry";
    begin
        StatusEntry.Init();
        StatusEntry."Agreement No." := AgreementNo;
        StatusEntry."Entry Date" := EntryDate;
        StatusEntry.Severity := StatusEntry.Severity::Error;
        StatusEntry.Resolved := Resolved;
        StatusEntry.Message := Msg;
        StatusEntry.Insert(true);
    end;

    [Test]
    procedure MostRecentlyLoggedEntryWinsOverAnOlderButLaterDatedOne()
    var
        Agreement: Record "CG X112 Job Agreement";
        SummaryBuilder: Codeunit "CG X112 Summary Builder";
        Summaries: Dictionary of [Code[20], Text[250]];
    begin
        ClearAll();
        SeedAgreement('A1', 'Keep me');
        SeedWarningEntry('A1', 20260820D, false, 'Late date early entry'); // logged first
        SeedErrorEntry('A1', 20260805D, false, 'Early date late entry'); // logged second

        Summaries := SummaryBuilder.BuildSummaries(Agreement, 20260831D);

        Assert.AreEqual(
            'Error: Early date late entry', Summaries.Get('A1'),
            'The summary must reflect the most recently logged status, even when an older entry carries a later date');
    end;

    [Test]
    procedure AgreementWithNoStatusHistoryReportsNoOpenIssues()
    var
        Agreement: Record "CG X112 Job Agreement";
        SummaryBuilder: Codeunit "CG X112 Summary Builder";
        Summaries: Dictionary of [Code[20], Text[250]];
    begin
        ClearAll();
        SeedAgreement('A2', 'Keep me');

        Summaries := SummaryBuilder.BuildSummaries(Agreement, 20260831D);

        Assert.AreEqual(
            'No open issues', Summaries.Get('A2'),
            'An agreement with no logged status must show no open issues');
    end;

    [Test]
    procedure ClosedStatusEntriesAreExcludedFromTheSummary()
    var
        Agreement: Record "CG X112 Job Agreement";
        SummaryBuilder: Codeunit "CG X112 Summary Builder";
        Summaries: Dictionary of [Code[20], Text[250]];
    begin
        ClearAll();
        SeedAgreement('A3', 'Keep me');
        SeedWarningEntry('A3', 20260810D, true, 'Already handled');

        Summaries := SummaryBuilder.BuildSummaries(Agreement, 20260831D);

        Assert.AreEqual(
            'No open issues', Summaries.Get('A3'),
            'A status entry already closed out must never appear as an open issue');
    end;

    [Test]
    procedure StatusLoggedExactlyOnTheAsOfDateStillCounts()
    var
        Agreement: Record "CG X112 Job Agreement";
        SummaryBuilder: Codeunit "CG X112 Summary Builder";
        Summaries: Dictionary of [Code[20], Text[250]];
    begin
        ClearAll();
        SeedAgreement('A4', 'Keep me');
        SeedErrorEntry('A4', 20260831D, false, 'On the line');

        Summaries := SummaryBuilder.BuildSummaries(Agreement, 20260831D);

        Assert.AreEqual(
            'Error: On the line', Summaries.Get('A4'),
            'A status logged exactly on the as-of date must still be reported');
    end;

    [Test]
    procedure StatusLoggedTheDayAfterTheAsOfDateIsNotYetVisible()
    var
        Agreement: Record "CG X112 Job Agreement";
        SummaryBuilder: Codeunit "CG X112 Summary Builder";
        Summaries: Dictionary of [Code[20], Text[250]];
    begin
        ClearAll();
        SeedAgreement('A5', 'Keep me');
        SeedErrorEntry('A5', 20260901D, false, 'Too soon');

        Summaries := SummaryBuilder.BuildSummaries(Agreement, 20260831D);

        Assert.AreEqual(
            'No open issues', Summaries.Get('A5'),
            'A status logged after the as-of date must not be reported yet');
    end;

    [Test]
    procedure EachAgreementsSummaryReflectsOnlyItsOwnHistory()
    var
        Agreement: Record "CG X112 Job Agreement";
        SummaryBuilder: Codeunit "CG X112 Summary Builder";
        Summaries: Dictionary of [Code[20], Text[250]];
    begin
        ClearAll();
        SeedAgreement('A6A', 'Keep me');
        SeedAgreement('A6B', 'Keep me');
        SeedErrorEntry('A6A', 20260810D, false, 'Trouble on A');
        SeedWarningEntry('A6B', 20260812D, false, 'Trouble on B');

        Summaries := SummaryBuilder.BuildSummaries(Agreement, 20260831D);

        Assert.AreEqual('Error: Trouble on A', Summaries.Get('A6A'), 'Agreement A6A must show only its own history');
        Assert.AreEqual('Warning: Trouble on B', Summaries.Get('A6B'), 'Agreement A6B must show only its own history');
    end;

    [Test]
    procedure OnlyAgreementsInTheBatchAreReported()
    var
        Agreement: Record "CG X112 Job Agreement";
        SummaryBuilder: Codeunit "CG X112 Summary Builder";
        Summaries: Dictionary of [Code[20], Text[250]];
    begin
        ClearAll();
        SeedAgreement('B1', 'Keep me');
        SeedAgreement('B2', 'Keep me');
        SeedAgreement('B3', 'Keep me');
        SeedErrorEntry('B1', 20260810D, false, 'Trouble on B1');
        SeedWarningEntry('B2', 20260812D, false, 'Trouble on B2');
        SeedErrorEntry('B3', 20260814D, false, 'Trouble on B3');

        Agreement.SetFilter("No.", 'B1|B2');
        Summaries := SummaryBuilder.BuildSummaries(Agreement, 20260831D);

        Assert.AreEqual('Error: Trouble on B1', Summaries.Get('B1'), 'B1 is in the requested batch and must be reported');
        Assert.AreEqual('Warning: Trouble on B2', Summaries.Get('B2'), 'B2 is in the requested batch and must be reported');
        Assert.IsFalse(Summaries.ContainsKey('B3'), 'B3 was not part of the requested batch and must not appear in the result');
    end;

    [Test]
    procedure AnOpenEntryWithNoMatchingAgreementIsNotReported()
    var
        Agreement: Record "CG X112 Job Agreement";
        SummaryBuilder: Codeunit "CG X112 Summary Builder";
        Summaries: Dictionary of [Code[20], Text[250]];
    begin
        ClearAll();
        SeedAgreement('B4', 'Keep me');
        SeedErrorEntry('GHOST', 20260810D, false, 'No agreement owns this');

        Summaries := SummaryBuilder.BuildSummaries(Agreement, 20260831D);

        Assert.AreEqual('No open issues', Summaries.Get('B4'), 'B4 has no open issue of its own');
        Assert.IsFalse(Summaries.ContainsKey('GHOST'), 'A status entry with no matching agreement must not appear in the result');
    end;

    [Test]
    procedure AnInformationalStatusEntryIsAlsoReported()
    var
        Agreement: Record "CG X112 Job Agreement";
        SummaryBuilder: Codeunit "CG X112 Summary Builder";
        Summaries: Dictionary of [Code[20], Text[250]];
    begin
        ClearAll();
        SeedAgreement('A7', 'Keep me');
        SeedInfoEntry('A7', 20260810D, false, 'Just a note');

        Summaries := SummaryBuilder.BuildSummaries(Agreement, 20260831D);

        Assert.AreEqual('Info: Just a note', Summaries.Get('A7'), 'An informational status entry must also be reported');
    end;

    [Test]
    procedure SummariesReflectAnIssueLoggedSinceTheLastBuild()
    var
        Agreement: Record "CG X112 Job Agreement";
        SummaryBuilder: Codeunit "CG X112 Summary Builder";
        Summaries: Dictionary of [Code[20], Text[250]];
    begin
        ClearAll();
        SeedAgreement('A8', 'Keep me');

        Summaries := SummaryBuilder.BuildSummaries(Agreement, 20260831D);
        Assert.AreEqual('No open issues', Summaries.Get('A8'), 'Before anything is logged, A8 has no open issue');

        SeedErrorEntry('A8', 20260810D, false, 'Logged after the first build');
        Summaries := SummaryBuilder.BuildSummaries(Agreement, 20260831D);
        Assert.AreEqual(
            'Error: Logged after the first build', Summaries.Get('A8'),
            'A later build on the same instance must reflect an issue logged since the earlier build');
    end;

    [Test]
    procedure AgreementDescriptionIsNotChangedByBuildingSummaries()
    var
        Agreement: Record "CG X112 Job Agreement";
        SummaryBuilder: Codeunit "CG X112 Summary Builder";
        Summaries: Dictionary of [Code[20], Text[250]];
    begin
        ClearAll();
        SeedAgreement('A9', 'Original description');
        SeedErrorEntry('A9', 20260810D, false, 'Some issue');

        Summaries := SummaryBuilder.BuildSummaries(Agreement, 20260831D);

        Agreement.Get('A9');
        Assert.AreEqual('Original description', Agreement.Description, 'Building the summaries must not change an agreement''s own description');
    end;

    [Test]
    procedure SummaryBuildCostDoesNotScaleWithTheNumberOfAgreements()
    var
        Agreement: Record "CG X112 Job Agreement";
        SummaryBuilder: Codeunit "CG X112 Summary Builder";
        Summaries: Dictionary of [Code[20], Text[250]];
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        StmtDelta: BigInteger;
        AgreementNo: Code[20];
        i: Integer;
    begin
        ClearAll();

        // Warm-up: build a summary for a single, unrelated agreement so
        // first-touch metadata/plan loading lands outside the measurement
        // window below.
        SeedAgreement('WARM', 'Keep me');
        SeedErrorEntry('WARM', 20260101D, false, 'Warm-up issue');
        Summaries := SummaryBuilder.BuildSummaries(Agreement, 20260201D);
        Assert.AreEqual('Error: Warm-up issue', Summaries.Get('WARM'), 'The warm-up call must still report correctly');
        ClearAll();

        // 400 agreements; only a handful (the first 10) have an open status
        // entry as of the cutoff below, matching the everyday case - the
        // rest have none and must fall back to the all-clear message.
        for i := 1 to 400 do begin
            AgreementNo := StrSubstNo('P%1', i);
            SeedAgreement(AgreementNo, 'Keep me');
            if i <= 10 then
                if i mod 2 = 0 then
                    SeedWarningEntry(AgreementNo, 20260801D, false, StrSubstNo('Issue %1', i))
                else
                    SeedErrorEntry(AgreementNo, 20260801D, false, StrSubstNo('Issue %1', i));
        end;

        SelectLatestVersion();
        StmtBefore := SessionInformation.SqlStatementsExecuted;

        Summaries := SummaryBuilder.BuildSummaries(Agreement, 20260831D);

        StmtAfter := SessionInformation.SqlStatementsExecuted;
        StmtDelta := StmtAfter - StmtBefore;

        Assert.AreEqual('Error: Issue 1', Summaries.Get('P1'), 'Agreement P1 must report its own logged issue');
        Assert.AreEqual('Warning: Issue 2', Summaries.Get('P2'), 'Agreement P2 must report its own logged issue');
        Assert.AreEqual('No open issues', Summaries.Get('P400'), 'Agreement P400 has no open issue and must say so');
        Assert.IsTrue(
            StmtDelta <= 20,
            StrSubstNo('The summaries must be built at a cost that does not grow with the number of agreements: budget %1, actual %2', 20, StmtDelta));
    end;
}
