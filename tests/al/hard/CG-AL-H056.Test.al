codeunit 80271 "CG-AL-H056 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestBumpAndGetCount()
    var
        A: Codeunit "CG H056 Counter";
    begin
        A.Bump();
        A.Bump();
        A.Bump();
        Assert.AreEqual(3, A.GetCount(), 'Three Bump calls give count 3.');
    end;

    [Test]
    procedure TestHandoffCopiesCountAcrossInstances()
    var
        A: Codeunit "CG H056 Counter";
        B: Codeunit "CG H056 Counter";
    begin
        A.Bump();
        A.Bump();
        A.Bump();
        A.Bump();
        A.Bump();
        Assert.AreEqual(0, B.GetCount(), 'B starts at zero.');

        // A hands itself off to B; B's AbsorbFrom reads A.GetCount() and
        // overwrites B's count. The only way HandoffTo can supply A as the
        // argument to B.AbsorbFrom is via the self-reference keyword.
        A.HandoffTo(B);

        Assert.AreEqual(5, B.GetCount(), 'B count must now match A count (5).');
        Assert.AreEqual(5, A.GetCount(), 'A count is unchanged by handoff.');
    end;

    [Test]
    procedure TestHandoffOverwrites()
    var
        A: Codeunit "CG H056 Counter";
        B: Codeunit "CG H056 Counter";
    begin
        B.Bump();
        B.Bump();
        B.Bump();
        B.Bump();
        // A has count 0 (no Bump). Handoff from A must overwrite B's 4 with 0.
        A.HandoffTo(B);
        Assert.AreEqual(0, B.GetCount(), 'Handoff from A (0) overwrites B (was 4).');
    end;

    [Test]
    procedure TestAbsorbFromDirectly()
    var
        A: Codeunit "CG H056 Counter";
        B: Codeunit "CG H056 Counter";
    begin
        A.Bump();
        A.Bump();
        B.AbsorbFrom(A);
        Assert.AreEqual(2, B.GetCount(), 'AbsorbFrom(A) sets B count to A count.');
    end;
}
