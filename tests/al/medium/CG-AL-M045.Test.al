codeunit 80107 "CG-AL-M045 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestValidateToNewValueIncrementsOnce()
    var
        WatchedRec: Record "CG M045 Watched Record";
        FireCounter: Codeunit "CG M045 Fire Counter";
    begin
        WatchedRec.DeleteAll();
        FireCounter.Reset();

        WatchedRec.Init();
        WatchedRec."Entry No." := 1;
        WatchedRec."Watched Code" := 'A';
        WatchedRec.Insert();

        WatchedRec.Validate("Watched Code", 'B');

        Assert.AreEqual('B', WatchedRec."Watched Code", 'Watched Code must reflect the validated value');
        Assert.AreEqual(1, FireCounter.GetCount(), 'Fire counter must read 1 after a single Validate to a new value');
    end;

    [Test]
    procedure TestRevalidateSameValueDoesNotIncrement()
    var
        WatchedRec: Record "CG M045 Watched Record";
        FireCounter: Codeunit "CG M045 Fire Counter";
    begin
        WatchedRec.DeleteAll();
        FireCounter.Reset();

        WatchedRec.Init();
        WatchedRec."Entry No." := 2;
        WatchedRec."Watched Code" := 'A';
        WatchedRec.Insert();

        WatchedRec.Validate("Watched Code", 'B');
        Assert.AreEqual(1, FireCounter.GetCount(), 'Counter must read 1 after first Validate to a new value');

        WatchedRec.Validate("Watched Code", 'B');

        Assert.AreEqual('B', WatchedRec."Watched Code", 'Watched Code must remain B after re-Validate of the same value');
        Assert.AreEqual(1, FireCounter.GetCount(), 'Counter must NOT advance when Validate is called with the value already stored');
    end;

    [Test]
    procedure TestValidateToDifferentValueIncrements()
    var
        WatchedRec: Record "CG M045 Watched Record";
        FireCounter: Codeunit "CG M045 Fire Counter";
    begin
        WatchedRec.DeleteAll();
        FireCounter.Reset();

        WatchedRec.Init();
        WatchedRec."Entry No." := 3;
        WatchedRec."Watched Code" := 'A';
        WatchedRec.Insert();

        WatchedRec.Validate("Watched Code", 'B');
        WatchedRec.Validate("Watched Code", 'B');
        WatchedRec.Validate("Watched Code", 'C');

        Assert.AreEqual('C', WatchedRec."Watched Code", 'Watched Code must reflect the latest validated value');
        Assert.AreEqual(2, FireCounter.GetCount(), 'Counter must read 2: one for A->B, one for B->C; the no-op B->B must not count');
    end;

    [Test]
    procedure TestValidateBackToOriginalIncrements()
    var
        WatchedRec: Record "CG M045 Watched Record";
        FireCounter: Codeunit "CG M045 Fire Counter";
    begin
        WatchedRec.DeleteAll();
        FireCounter.Reset();

        WatchedRec.Init();
        WatchedRec."Entry No." := 4;
        WatchedRec."Watched Code" := 'A';
        WatchedRec.Insert();

        WatchedRec.Validate("Watched Code", 'B');
        WatchedRec.Validate("Watched Code", 'A');

        Assert.AreEqual('A', WatchedRec."Watched Code", 'Watched Code must reflect the validated value');
        Assert.AreEqual(2, FireCounter.GetCount(), 'Counter must read 2: A->B and B->A both change the stored value');
    end;

    [Test]
    procedure TestValidateOtherFieldDoesNotIncrement()
    var
        WatchedRec: Record "CG M045 Watched Record";
        FireCounter: Codeunit "CG M045 Fire Counter";
    begin
        WatchedRec.DeleteAll();
        FireCounter.Reset();

        WatchedRec.Init();
        WatchedRec."Entry No." := 5;
        WatchedRec."Watched Code" := 'A';
        WatchedRec.Insert();

        WatchedRec.Validate(Description, 'first description');
        WatchedRec.Validate(Description, 'second description');

        Assert.AreEqual('second description', WatchedRec.Description, 'Description must reflect the latest validated value');
        Assert.AreEqual(0, FireCounter.GetCount(), 'Counter must remain 0 when validating a field other than Watched Code');
    end;

    [Test]
    procedure TestRepeatedNoOpRevalidateNeverAdvances()
    var
        WatchedRec: Record "CG M045 Watched Record";
        FireCounter: Codeunit "CG M045 Fire Counter";
        I: Integer;
    begin
        WatchedRec.DeleteAll();
        FireCounter.Reset();

        WatchedRec.Init();
        WatchedRec."Entry No." := 6;
        WatchedRec."Watched Code" := 'X';
        WatchedRec.Insert();

        for I := 1 to 5 do
            WatchedRec.Validate("Watched Code", 'X');

        Assert.AreEqual('X', WatchedRec."Watched Code", 'Watched Code must remain X across no-op revalidations');
        Assert.AreEqual(0, FireCounter.GetCount(), 'Counter must read 0 when every Validate is a no-op revalidate');
    end;
}
