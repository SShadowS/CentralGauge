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

        Evaluate(TaskId, '9223372036854775000');
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
    begin
        Demo.DeleteAll();

        Demo.Init();
        Demo."No." := 'TASK-ZERO';
        Demo."Task Reference" := 0;
        Demo.Insert();

        Clear(Demo);
        Demo.Get('TASK-ZERO');
        Assert.AreEqual(0, Demo."Task Reference", 'Task Reference BigInteger should accept zero');

        Demo.Delete();
    end;
}
