codeunit 88814 "CG-AL-X061 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Seed(ProjectCode: Code[20]; TaskCount: Integer)
    var
        Project: Record "CG X061 Project";
        Task: Record "CG X061 Task";
        i: Integer;
        NextNo: Integer;
    begin
        if not Project.Get(ProjectCode) then begin
            Project.Init();
            Project."Code" := ProjectCode;
            Project.Insert();
        end;

        if Task.FindLast() then
            NextNo := Task."Entry No.";

        for i := 1 to TaskCount do begin
            NextNo += 1;
            Task.Init();
            Task."Entry No." := NextNo;
            Task."Project Code" := ProjectCode;
            Task.Insert();
        end;
    end;

    local procedure Reset()
    var
        Project: Record "CG X061 Project";
        Task: Record "CG X061 Task";
    begin
        Task.DeleteAll();
        Project.DeleteAll();
    end;

    [Test]
    procedure ReturnsTheTaskCount()
    var
        Counter: Codeunit "CG X061 Counter";
    begin
        Reset();
        Seed('P1', 3);
        Assert.AreEqual(3, Counter.TaskCountOf('P1'), 'P1 has three tasks');
    end;

    [Test]
    procedure ReturnsZeroForAProjectWithNoTasks()
    var
        Counter: Codeunit "CG X061 Counter";
    begin
        Reset();
        Seed('EMPTY', 0);
        Assert.AreEqual(0, Counter.TaskCountOf('EMPTY'), 'A project with no tasks counts zero');
    end;

    [Test]
    procedure ReturnsZeroForAnUnknownProject()
    var
        Counter: Codeunit "CG X061 Counter";
    begin
        Reset();
        Assert.AreEqual(0, Counter.TaskCountOf('NOPE'), 'An unknown project counts zero');
    end;

    [Test]
    procedure CountsOnlyTheRequestedProject()
    var
        Counter: Codeunit "CG X061 Counter";
    begin
        Reset();
        Seed('P1', 2);
        Seed('P2', 5);
        Assert.AreEqual(2, Counter.TaskCountOf('P1'), 'P1 has two tasks');
        Assert.AreEqual(5, Counter.TaskCountOf('P2'), 'P2 has five tasks');
    end;
}
