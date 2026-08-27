codeunit 80007 "CG-AL-H006 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Counter: Codeunit "CG Session Counter";

    [Test]
    procedure TestIncrementAndGet()
    var
        Result1: Integer;
        Result2: Integer;
    begin
        // [SCENARIO] IncrementAndGet increments and returns new value
        Counter.Reset();

        Result1 := Counter.IncrementAndGet();
        Result2 := Counter.IncrementAndGet();

        Assert.AreEqual(1, Result1, 'First increment should return 1');
        Assert.AreEqual(2, Result2, 'Second increment should return 2');
    end;

    [Test]
    procedure TestGetCallCountWithoutIncrement()
    var
        CountBefore: Integer;
        CountAfter: Integer;
    begin
        // [SCENARIO] GetCallCount does not increment
        Counter.Reset();
        Counter.IncrementAndGet();
        Counter.IncrementAndGet();

        CountBefore := Counter.GetCallCount();
        CountAfter := Counter.GetCallCount();

        // Absolute before relative: a getter that always answered 0 would satisfy
        // AreEqual(CountBefore, CountAfter) on its own.
        Assert.AreEqual(2, CountBefore, 'GetCallCount should report the two increments already made');
        Assert.AreEqual(2, CountAfter, 'GetCallCount should still report two after being read once');
        Assert.AreEqual(CountBefore, CountAfter, 'GetCallCount should not change the count');
    end;

    [Test]
    procedure GetCallCountReportsTheNumberOfIncrements()
    begin
        // [SCENARIO] GetCallCount reports the running count, not merely a value that
        // is stable and zero. Every other test that touches it asserts only a
        // relative or zero-valued property, so a getter hardcoded to 0 passed them all.
        Counter.Reset();
        Counter.IncrementAndGet();
        Counter.IncrementAndGet();

        Assert.AreEqual(2, Counter.GetCallCount(), 'Expected the call count to report the two increments already made');
    end;

    [Test]
    procedure TestResetClearsCount()
    var
        CountAfterReset: Integer;
    begin
        // [SCENARIO] Reset clears the call count
        Counter.IncrementAndGet();
        Counter.IncrementAndGet();
        Counter.IncrementAndGet();

        Counter.Reset();
        CountAfterReset := Counter.GetCallCount();

        Assert.AreEqual(0, CountAfterReset, 'Count should be 0 after reset');
    end;

    [Test]
    procedure TestInitializeIdempotent()
    var
        Duration1: Duration;
        Duration2: Duration;
    begin
        // [SCENARIO] Initialize is idempotent - multiple calls don't reset session start
        Counter.Reset();
        Counter.Initialize();

        // Small delay to ensure time passes
        Sleep(100);

        Duration1 := Counter.GetSessionDuration();

        // Call Initialize again
        Counter.Initialize();

        // Another small delay
        Sleep(100);

        Duration2 := Counter.GetSessionDuration();

        // Duration2 should be longer since session wasn't reset
        Assert.IsTrue(Duration2 > Duration1, 'Initialize should be idempotent - session start should not reset');
    end;

    [Test]
    procedure TestGetSessionDurationWithoutInitialize()
    var
        Duration: Duration;
    begin
        // [SCENARIO] GetSessionDuration returns 0 if Initialize was never called
        // Note: This depends on SingleInstance state from previous tests
        // In a fresh session, this should return 0
        // This test verifies the Duration type is returned correctly
        Duration := Counter.GetSessionDuration();
        // Just verify it doesn't error - Duration could be 0 or have value from prior Initialize
        Assert.IsTrue(Duration >= 0, 'Duration should be non-negative');
    end;

    [Test]
    procedure TestSingleInstancePersistence()
    var
        Counter2: Codeunit "CG Session Counter";
        Count1: Integer;
        Count2: Integer;
    begin
        // [SCENARIO] SingleInstance means state persists across different variable instances
        Counter.Reset();
        Counter.IncrementAndGet();
        Counter.IncrementAndGet();

        Count1 := Counter.GetCallCount();

        // Use a different variable pointing to same SingleInstance codeunit
        Count2 := Counter2.GetCallCount();

        // Again absolute first, so a constant-0 getter cannot satisfy the shared-state
        // claim by answering 0 through both variables.
        Assert.AreEqual(2, Count2, 'The second variable should report the two increments made through the first');
        Assert.AreEqual(Count1, Count2, 'SingleInstance should share state across variables');
    end;
}
