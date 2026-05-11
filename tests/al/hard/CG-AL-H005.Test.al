codeunit 80006 "CG-AL-H005 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestDescribeChanges_PriceOnly()
    var
        TrackedItem: Record "CG Tracked Item";
        Result: Text;
    begin
        // [SCENARIO] Unit Price change classified as 'PriceChanged'
        Result := TrackedItem.DescribeChanges(100, false, 150, false);
        Assert.IsTrue(StrPos(Result, 'PriceChanged') > 0, 'Result must contain PriceChanged when Unit Price changed');
        Assert.IsTrue(StrPos(Result, 'BlockedActivated') = 0, 'Result must NOT contain BlockedActivated when Blocked is unchanged');
    end;

    [Test]
    procedure TestDescribeChanges_BlockedActivation()
    var
        TrackedItem: Record "CG Tracked Item";
        Result: Text;
    begin
        // [SCENARIO] Blocked false->true classified as 'BlockedActivated'
        Result := TrackedItem.DescribeChanges(100, false, 100, true);
        Assert.AreEqual('BlockedActivated', Result, 'Pure Blocked false->true must classify as BlockedActivated');
    end;

    [Test]
    procedure TestDescribeChanges_UnblockingTrap()
    var
        TrackedItem: Record "CG Tracked Item";
        Result: Text;
    begin
        // [SCENARIO] Blocked true->false (the trap) must NOT produce BlockedActivated
        Result := TrackedItem.DescribeChanges(100, true, 100, false);
        Assert.AreEqual('', Result, 'Unblocking with no other change must return empty string');
    end;

    [Test]
    procedure TestDescribeChanges_NoChange()
    var
        TrackedItem: Record "CG Tracked Item";
    begin
        // [SCENARIO] No change must return empty string
        Assert.AreEqual('', TrackedItem.DescribeChanges(100, false, 100, false), 'No change should return empty');
        Assert.AreEqual('', TrackedItem.DescribeChanges(0, true, 0, true), 'No change should return empty');
    end;

    [Test]
    procedure TestDescribeChanges_CombinedAndTrap()
    var
        TrackedItem: Record "CG Tracked Item";
        Result: Text;
    begin
        // [SCENARIO] Both fields changing in the same call produces both tokens in canonical order;
        // the unblock trap must drop BlockedActivated.
        Result := TrackedItem.DescribeChanges(100, false, 150, true);
        Assert.AreEqual('PriceChanged|BlockedActivated', Result, 'Combined change must use canonical pipe-separated order');

        Result := TrackedItem.DescribeChanges(100, true, 200, false);
        Assert.AreEqual('PriceChanged', Result, 'Price change with unblocking must classify only as PriceChanged');
    end;

    [Test]
    procedure TestLogger_TracksAndJoinsEntries()
    var
        Logger: Codeunit "CG H005 Logger";
    begin
        // [SCENARIO] Logger captures entries in call order and joins them with ';'.
        // Verifying the Logger directly (not from inside a table trigger) sidesteps the
        // BC test-runner isolation quirk that hides side effects raised inside an OnModify
        // trigger inside a test transaction.
        Logger.Reset();
        Assert.AreEqual('', Logger.GetLog(), 'GetLog should be empty after Reset');

        Logger.Log('PriceChanged');
        Assert.AreEqual('PriceChanged', Logger.GetLog(), 'Single entry must round-trip through GetLog');

        Logger.Log('BlockedActivated');
        Assert.AreEqual('PriceChanged;BlockedActivated', Logger.GetLog(), 'Multiple entries must be joined by single semicolons in call order');

        Logger.Reset();
        Assert.AreEqual('', Logger.GetLog(), 'Reset must clear all entries');
    end;
}
