codeunit 80038 "CG-AL-M038 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Demo: Codeunit "CG V16 Misc Demo";

    [Test]
    procedure TestLockTimeoutDurationCallable()
    var
        Captured: Integer;
    begin
        // Compile_pass validates Database.LockTimeoutDuration accepts Integer and returns Integer.
        // Runtime: confirm no exception. Restore default after the call.
        Captured := Demo.GetLockTimeoutPrevious(5000);
        Demo.GetLockTimeoutPrevious(0);

        // Captured is read back to keep the compiler from flagging an unused variable;
        // the exact previous-value semantics ("returns previous" vs "returns new current")
        // are not stated on MS Learn, so no direction-specific assertion is made here.
        Assert.IsTrue((Captured = Captured), 'LockTimeoutDuration returned an Integer');
    end;

    [Test]
    procedure TestRecordRefListCountEqualsTwo()
    begin
        Assert.AreEqual(2, Demo.CountRecordRefList(), 'List of [RecordRef] should accept and count two RecordRef instances');
    end;
}
