codeunit 80040 "CG-AL-M040 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestTaskReferenceFieldRoundTrip()
    var
        Demo: Record "CG Task Demo";
        TaskId: BigInteger;
    begin
        Demo.DeleteAll();

        Assert.IsTrue(Evaluate(TaskId, '9223372036854775000'), 'Test setup: boundary task id must parse');
        Demo.Init();
        Demo."No." := 'TASK-001';
        Demo."Task Reference" := TaskId;
        Demo.Insert();

        Clear(Demo);
        Assert.IsTrue(Demo.Get('TASK-001'), 'Inserted record should be retrievable by primary key');
        Assert.AreEqual(TaskId, Demo."Task Reference", 'Task Reference BigInteger should round-trip through the table');

        Demo.Delete();
    end;

    [Test]
    procedure TestTaskReferenceFieldZero()
    var
        Demo: Record "CG Task Demo";
        ZeroTaskId: BigInteger;
    begin
        Demo.DeleteAll();

        Demo.Init();
        Demo."No." := 'TASK-ZERO';
        ZeroTaskId := 0;
        Demo."Task Reference" := ZeroTaskId;
        Demo.Insert();

        Clear(Demo);
        Assert.IsTrue(Demo.Get('TASK-ZERO'), 'Zero-valued record should be retrievable by primary key');
        // Compare BigInteger against BigInteger: Assert.AreEqual is type-strict and an
        // Integer literal 0 never equals a BigInteger 0, even though the values match.
        Assert.AreEqual(ZeroTaskId, Demo."Task Reference", 'Task Reference BigInteger should accept zero');

        Demo.Delete();
    end;
}
