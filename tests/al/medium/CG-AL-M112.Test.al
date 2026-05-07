codeunit 80012 "CG-AL-M112 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestFlowFieldsSumPostedAndOpenHours()
    var
        Project: Record "CG Project";
        TimeEntry: Record "CG Time Entry";
        ProjectNo: Code[20];
    begin
        // [SCENARIO] FlowFields sum posted and open hours correctly
        ProjectNo := CopyStr(DelChr(Format(CreateGuid()), '=', '{}-'), 1, 20);

        Project.Init();
        Project."No." := ProjectNo;
        Project.Description := 'P';
        Project.Insert(true);

        Clear(TimeEntry);
        TimeEntry.Init();
        TimeEntry.Validate("Project No.", ProjectNo);
        TimeEntry."Entry Date" := 0D;
        TimeEntry.Validate(Hours, 2.5);
        TimeEntry.Posted := true;
        TimeEntry.Insert(true);

        Clear(TimeEntry);
        TimeEntry.Init();
        TimeEntry.Validate("Project No.", ProjectNo);
        TimeEntry."Entry Date" := 0D;
        TimeEntry.Validate(Hours, 1.25);
        TimeEntry.Posted := false;
        TimeEntry.Insert(true);

        Clear(Project);
        Project.Get(ProjectNo);
        Project.CalcFields("Total Posted Hours", "Total Open Hours");

        Assert.AreEqual(2.5, Project."Total Posted Hours", 'Total Posted Hours should sum posted entries');
        Assert.AreEqual(1.25, Project."Total Open Hours", 'Total Open Hours should sum open entries');

        // Cleanup
        TimeEntry.Reset();
        TimeEntry.SetRange("Project No.", ProjectNo);
        TimeEntry.DeleteAll(true);

        Project.Delete(true);
    end;

    [Test]
    procedure TestTimeEntryDefaultEntryDateOnInsert()
    var
        Project: Record "CG Project";
        TimeEntry: Record "CG Time Entry";
        ProjectNo: Code[20];
        EntryNo: Integer;
    begin
        // [SCENARIO] Entry Date defaults to WorkDate on insert
        ProjectNo := CopyStr(DelChr(Format(CreateGuid()), '=', '{}-'), 1, 20);

        Project.Init();
        Project."No." := ProjectNo;
        Project.Description := 'P';
        Project.Insert(true);

        TimeEntry.Init();
        TimeEntry.Validate("Project No.", ProjectNo);
        TimeEntry."Entry Date" := 0D;
        TimeEntry.Validate(Hours, 1);
        TimeEntry.Insert(true);

        EntryNo := TimeEntry."Entry No.";

        Clear(TimeEntry);
        TimeEntry.Get(EntryNo);
        Assert.AreEqual(WorkDate(), TimeEntry."Entry Date", 'Entry Date should be set to WorkDate on insert when blank');

        // Cleanup
        TimeEntry.Delete(true);
        Project.Delete(true);
    end;

    [Test]
    procedure TestHoursValidationBlocksZeroAndNegative()
    var
        TimeEntry: Record "CG Time Entry";
    begin
        // [SCENARIO] Hours <= 0 is blocked with exact error text
        TimeEntry.Init();

        asserterror TimeEntry.Validate(Hours, 0);
        Assert.AreEqual('Hours must be greater than zero', GetLastErrorText(), 'Hours = 0 must be blocked');

        asserterror TimeEntry.Validate(Hours, -1);
        Assert.AreEqual('Hours must be greater than zero', GetLastErrorText(), 'Hours < 0 must be blocked');
    end;

    [Test]
    procedure TestProjectDeleteBlockedWhenTimeEntriesExist()
    var
        Project: Record "CG Project";
        TimeEntry: Record "CG Time Entry";
        ProjectNo: Code[20];
    begin
        // [SCENARIO] Project deletion is blocked while any time entries exist
        ProjectNo := CopyStr(DelChr(Format(CreateGuid()), '=', '{}-'), 1, 20);

        Project.Init();
        Project."No." := ProjectNo;
        Project.Description := 'P';
        Project.Insert(true);

        Clear(TimeEntry);
        TimeEntry.Init();
        TimeEntry.Validate("Project No.", ProjectNo);
        TimeEntry.Validate(Hours, 1);
        TimeEntry.Posted := false;
        TimeEntry.Insert(true);

        asserterror Project.Delete(true);
        Assert.AreEqual('Cannot delete project with time entries', GetLastErrorText(), 'Delete should be blocked');
        // asserterror rolls the transaction back to the last Commit, so the project
        // and time entry are removed automatically. No further DB ops are valid here.
    end;
}
