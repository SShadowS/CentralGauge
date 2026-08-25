codeunit 89309 "CG-AL-X115 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // Every comparison below is built and asserted purely in memory - no
    // DateTime here is ever written to and read back from a table. A SQL
    // round trip can itself move a stored DateTime by a few milliseconds
    // (measured: up to 4 ms of drift between two round-tripped values),
    // which would be enough to shift a 9 ms boundary case across the
    // 10 ms line and make this oracle flaky.
    local procedure BaseMoment(): DateTime
    begin
        exit(CreateDateTime(20260615D, 093000T));
    end;

    [Test]
    procedure ZeroDriftIsTheSameMoment()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
    begin
        Moment := BaseMoment();
        Assert.IsTrue(Detector.IsSameMoment(Moment, Moment),
            'Expected two identical timestamps to be the same moment');
    end;

    [Test]
    procedure NineMillisecondDriftIsTheSameMomentReversedOrder()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
    begin
        Moment := BaseMoment();
        Assert.IsTrue(Detector.IsSameMoment(Moment + 9, Moment),
            'Expected timestamps 9 milliseconds apart to be the same moment regardless of argument order');
    end;

    [Test]
    procedure TenMillisecondGapIsADifferentMoment()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
    begin
        Moment := BaseMoment();
        Assert.IsFalse(Detector.IsSameMoment(Moment, Moment + 10),
            'Expected timestamps exactly 10 milliseconds apart to be different moments');
    end;

    [Test]
    procedure TwentyMillisecondGapIsADifferentMomentReversedOrder()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
    begin
        Moment := BaseMoment();
        Assert.IsFalse(Detector.IsSameMoment(Moment + 20, Moment),
            'Expected timestamps 20 milliseconds apart to be different moments regardless of argument order');
    end;

    // Not disclosed anywhere: a model that only memorized the shown 0/3/9
    // (same) and 10/20 (different) millisecond examples fails somewhere in
    // this range instead of generalizing the rule. AL stops at the first
    // failing assertion, so a failing sweep discloses exactly one drift
    // value per attempt rather than the whole hidden set at once.
    [Test]
    procedure IsSameMomentMatchesTheDisclosedRuleAcrossTheFullDriftRange()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
        DriftMs: Integer;
    begin
        Moment := BaseMoment();
        for DriftMs := 0 to 40 do begin
            Assert.AreEqual(DriftMs < 10, Detector.IsSameMoment(Moment, Moment + DriftMs),
                StrSubstNo('Expected IsSameMoment to follow the confirmed drift rule for a %1 millisecond gap', DriftMs));
            Assert.AreEqual(DriftMs < 10, Detector.IsSameMoment(Moment + DriftMs, Moment),
                StrSubstNo('Expected IsSameMoment to follow the confirmed drift rule for a %1 millisecond gap with the later timestamp passed first', DriftMs));
        end;
    end;

    [Test]
    procedure UndefinedFirstArgumentDiffersFromARealTimestamp()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
    begin
        Moment := BaseMoment();
        Assert.IsFalse(Detector.IsSameMoment(0DT, Moment),
            'Expected an undefined timestamp as the first argument to differ from a real timestamp');
    end;

    [Test]
    procedure UndefinedSecondArgumentDiffersFromARealTimestamp()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
    begin
        Moment := BaseMoment();
        Assert.IsFalse(Detector.IsSameMoment(Moment, 0DT),
            'Expected an undefined timestamp as the second argument to differ from a real timestamp');
    end;

    [Test]
    procedure TwoUndefinedTimestampsAreTheSameMoment()
    var
        Detector: Codeunit "CG X115 Change Detector";
    begin
        Assert.IsTrue(Detector.IsSameMoment(0DT, 0DT),
            'Expected two undefined timestamps to be the same moment');
    end;

    [Test]
    procedure ATenMillisecondGapTriggersAResync()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
    begin
        Moment := BaseMoment();
        Assert.IsTrue(Detector.ShouldResync(Moment + 10, Moment),
            'Expected a resync for a current timestamp exactly 10 milliseconds after the last synced one');
    end;

    // Signed sweep so the false/true split is exercised in both directions
    // (current ahead of last synced, and current behind it) without pinning
    // any single undisclosed drift value to its own named assertion.
    [Test]
    procedure ResyncDecisionMatchesTheDisclosedRuleAcrossTheFullDriftRange()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
        DriftMs: Integer;
    begin
        Moment := BaseMoment();
        for DriftMs := 0 to 40 do begin
            Assert.AreEqual(DriftMs >= 10, Detector.ShouldResync(Moment + DriftMs, Moment),
                StrSubstNo('Expected ShouldResync to follow the confirmed drift rule for a current timestamp %1 milliseconds ahead of the last synced one', DriftMs));
            Assert.AreEqual(DriftMs >= 10, Detector.ShouldResync(Moment, Moment + DriftMs),
                StrSubstNo('Expected ShouldResync to follow the confirmed drift rule for a current timestamp %1 milliseconds behind the last synced one', DriftMs));
        end;
    end;

    [Test]
    procedure AnUndefinedCurrentStampAgainstARealStoredStampTriggersAResync()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
    begin
        Moment := BaseMoment();
        Assert.IsTrue(Detector.ShouldResync(0DT, Moment),
            'Expected a resync when the current timestamp is undefined but the last synced timestamp is real');
    end;

    [Test]
    procedure ANeverSyncedRecordAlwaysTriggersAResync()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
    begin
        Moment := BaseMoment();
        Assert.IsTrue(Detector.ShouldResync(Moment, 0DT),
            'Expected a resync when the last synced timestamp is undefined, meaning the record has never been synced');
    end;

    [Test]
    procedure ANeverSyncedRecordTriggersAResyncEvenWithAnUndefinedCurrentStamp()
    var
        Detector: Codeunit "CG X115 Change Detector";
    begin
        Assert.IsTrue(Detector.ShouldResync(0DT, 0DT),
            'Expected a resync when the last synced timestamp is undefined, even if the current timestamp is undefined too');
    end;
}
