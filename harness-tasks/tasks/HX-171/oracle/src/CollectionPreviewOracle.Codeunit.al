codeunit 88525 "HX171 Collection Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        CollectionPreview: Codeunit "CGR Collection Preview";

    [Test]
    procedure OpenDueLinesListed()
    var
        Preview: Record "CGR Collection Preview Line" temporary;
    begin
        SeedHX171Fixture();
        Commit();

        RunHX171Preview('HX171-*', Preview);

        Preview.Reset();
        Preview.SetRange("Contract No.", 'HX171-A');
        Assert.AreEqual(2, Preview.Count(), 'Lease A: the February and March lines are due and not invoiced');
        Assert.IsTrue(Preview.Get('HX171-A', 20000), 'Lease A February line listed');
        Assert.AreEqual(20270215D, Preview."Due Date", 'Lease A February due date');
        Assert.AreEqual(110, Preview.Amount, 'Lease A February amount');
        Assert.IsTrue(Preview.Get('HX171-A', 30000), 'Lease A March line listed');
        Assert.AreEqual(20270315D, Preview."Due Date", 'Lease A March due date');
        Assert.AreEqual(120, Preview.Amount, 'Lease A March amount');
        Assert.IsFalse(Preview.Get('HX171-A', 10000), 'Lease A January line is invoiced already');
        Assert.IsFalse(Preview.Get('HX171-A', 40000), 'Lease A April line is due after UpToDate');
        Assert.IsFalse(Preview.Get('HX171-A', 0), 'Lease A passes its check and has no error line');
    end;

    [Test]
    procedure LeaseWithNothingDueHasNoLine()
    var
        Preview: Record "CGR Collection Preview Line" temporary;
    begin
        SeedHX171Fixture();
        Commit();

        RunHX171Preview('HX171-*', Preview);

        Preview.Reset();
        Preview.SetRange("Contract No.", 'HX171-E');
        Assert.AreEqual(0, Preview.Count(), 'Lease E has one invoiced line and one due after UpToDate: no line in the preview');
    end;

    [Test]
    procedure FailedLeaseListsNoScheduleLines()
    var
        Preview: Record "CGR Collection Preview Line" temporary;
    begin
        SeedHX171Fixture();
        Commit();

        RunHX171Preview('HX171-*', Preview);

        Preview.Reset();
        Preview.SetRange("Contract No.", 'HX171-B');
        Preview.SetFilter("Line No.", '<>0');
        Assert.AreEqual(0, Preview.Count(), 'Lease B fails its check: none of its schedule lines may stay in the preview');
        Preview.SetRange("Line No.");
        Assert.AreEqual(1, Preview.Count(), 'Lease B appears only with its error line');
    end;

    [Test]
    procedure FailedLeaseShowsCheckError()
    var
        Preview: Record "CGR Collection Preview Line" temporary;
    begin
        SeedHX171Fixture();
        Commit();

        RunHX171Preview('HX171-*', Preview);

        Preview.Reset();
        Assert.IsTrue(Preview.Get('HX171-B', 0), 'Lease B has its error line');
        Assert.AreEqual('Lease HX171-B schedule line 20000 has no amount to collect.', Preview."Error Text", 'Error line carries the check''s error text');
    end;

    [Test]
    procedure PassingLeasesKeepTheirLines()
    var
        Preview: Record "CGR Collection Preview Line" temporary;
    begin
        SeedHX171Fixture();
        Commit();

        RunHX171Preview('HX171-*', Preview);

        Preview.Reset();
        Preview.SetRange("Contract No.", 'HX171-A');
        Assert.AreEqual(2, Preview.Count(), 'Lease A, checked before the failing lease B, keeps its lines');
        Preview.SetRange("Contract No.", 'HX171-C');
        Assert.AreEqual(2, Preview.Count(), 'Lease C, checked after the failing lease B, keeps its lines');
        Preview.Reset();
        Assert.IsTrue(Preview.Get('HX171-C', 10000), 'Lease C 1 March line listed');
        Assert.AreEqual(300, Preview.Amount, 'Lease C 1 March amount');
        Assert.IsTrue(Preview.Get('HX171-C', 20000), 'Lease C line due exactly on UpToDate is listed');
        Assert.AreEqual(20270331D, Preview."Due Date", 'Lease C 31 March due date');
        Assert.AreEqual(310, Preview.Amount, 'Lease C 31 March amount');
        Assert.IsFalse(Preview.Get('HX171-C', 0), 'Lease C passes its check and has no error line');
    end;

    [Test]
    procedure SelectionOnlyIsPreviewed()
    var
        Preview: Record "CGR Collection Preview Line" temporary;
    begin
        SeedHX171Fixture();
        Commit();

        RunHX171Preview('HX171-A|HX171-C', Preview);

        Preview.Reset();
        Preview.SetRange("Contract No.", 'HX171-B');
        Assert.AreEqual(0, Preview.Count(), 'Lease B is not in the selection');
        Preview.SetRange("Contract No.", 'HX171-E');
        Assert.AreEqual(0, Preview.Count(), 'Lease E is not in the selection');
        Preview.Reset();
        Assert.IsTrue(Preview.Get('HX171-C', 10000), 'Lease C in the selection is listed');
        Assert.IsTrue(Preview.Get('HX171-A', 30000), 'Lease A in the selection is listed');
    end;

    [Test]
    procedure PartnerRefusalLeavesNoLines()
    var
        Preview: Record "CGR Collection Preview Line" temporary;
        Spy: Codeunit "HX171 Partner Spy";
    begin
        SeedHX171Fixture();
        Commit();
        Spy.RefuseAt('HX171-D', 20000);
        BindSubscription(Spy);

        RunHX171Preview('HX171-*', Preview);
        UnbindSubscription(Spy);

        Preview.Reset();
        Preview.SetRange("Contract No.", 'HX171-D');
        Preview.SetFilter("Line No.", '<>0');
        Assert.AreEqual(0, Preview.Count(), 'Lease D is refused by a partner on its second line: none of its schedule lines may stay');
        Preview.Reset();
        Assert.IsTrue(Preview.Get('HX171-D', 0), 'Lease D has its error line');
        Assert.AreEqual('Partner refuses lease HX171-D at line 20000.', Preview."Error Text", 'Error line carries the partner''s error text');
        Assert.IsTrue(Preview.Get('HX171-C', 10000), 'Lease C, which the partner does not refuse, keeps its line');
    end;

    [Test]
    procedure PartnerSeesLineInBuffer()
    var
        Preview: Record "CGR Collection Preview Line" temporary;
        Spy: Codeunit "HX171 Partner Spy";
    begin
        SeedHX171Fixture();
        Commit();
        Spy.Watch('HX171-A');
        BindSubscription(Spy);

        RunHX171Preview('HX171-*', Preview);
        UnbindSubscription(Spy);

        Assert.AreEqual(2, Spy.RaisedCount(), 'The event is raised once for each of lease A''s two preview lines');
        Assert.AreEqual(2, Spy.SeenInBufferCount(), 'At event time each line of lease A is already in the preview buffer');
    end;

    [Test]
    procedure PartnerAdjustmentPersists()
    var
        Preview: Record "CGR Collection Preview Line" temporary;
        Spy: Codeunit "HX171 Partner Spy";
    begin
        SeedHX171Fixture();
        Commit();
        Spy.AdjustAmounts('HX171-C');
        BindSubscription(Spy);

        RunHX171Preview('HX171-*', Preview);
        UnbindSubscription(Spy);

        Preview.Reset();
        Assert.IsTrue(Preview.Get('HX171-C', 10000), 'Lease C 1 March line listed');
        Assert.AreEqual(301, Preview.Amount, 'The partner''s adjustment of the 1 March line stays in the preview');
        Assert.IsTrue(Preview.Get('HX171-C', 20000), 'Lease C 31 March line listed');
        Assert.AreEqual(311, Preview.Amount, 'The partner''s adjustment of the 31 March line stays in the preview');
        Assert.IsFalse(Preview.Get('HX171-C', 0), 'Adjusting a line does not fail the lease');
    end;

    local procedure RunHX171Preview(LeaseFilter: Text; var Preview: Record "CGR Collection Preview Line" temporary)
    var
        Lease: Record "CGR Lease Contract";
    begin
        Lease.SetFilter("No.", LeaseFilter);
        CollectionPreview.BuildCollectionPreview(Lease, 20270331D, Preview);
    end;

    local procedure SeedHX171Fixture()
    begin
        ClearHX171();
        AddHX171Lease('HX171-A');
        AddHX171Line('HX171-A', 10000, 20270115D, 100, true);
        AddHX171Line('HX171-A', 20000, 20270215D, 110, false);
        AddHX171Line('HX171-A', 30000, 20270315D, 120, false);
        AddHX171Line('HX171-A', 40000, 20270415D, 130, false);
        AddHX171Lease('HX171-B');
        AddHX171Line('HX171-B', 10000, 20270115D, 200, false);
        AddHX171Line('HX171-B', 20000, 20270215D, 0, false);
        AddHX171Line('HX171-B', 30000, 20270315D, 210, false);
        AddHX171Lease('HX171-C');
        AddHX171Line('HX171-C', 10000, 20270301D, 300, false);
        AddHX171Line('HX171-C', 20000, 20270331D, 310, false);
        AddHX171Lease('HX171-D');
        AddHX171Line('HX171-D', 10000, 20270201D, 400, false);
        AddHX171Line('HX171-D', 20000, 20270301D, 410, false);
        AddHX171Lease('HX171-E');
        AddHX171Line('HX171-E', 10000, 20270115D, 50, true);
        AddHX171Line('HX171-E', 20000, 20270515D, 60, false);
    end;

    local procedure ClearHX171()
    var
        Lease: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        WorkDate(20270331D);
        ScheduleLine.SetFilter("Contract No.", 'HX171-*');
        ScheduleLine.DeleteAll();
        Lease.SetFilter("No.", 'HX171-*');
        Lease.DeleteAll();
    end;

    local procedure AddHX171Lease(LeaseNo: Code[20])
    var
        Lease: Record "CGR Lease Contract";
    begin
        Lease.Init();
        Lease."No." := LeaseNo;
        Lease."Vehicle No." := 'HX171-V';
        Lease."Customer Name" := 'HX171 Customer';
        Lease."Start Date" := 20270115D;
        Lease.Months := 4;
        Lease."Base Rate" := 100;
        Lease.Insert();
    end;

    local procedure AddHX171Line(LeaseNo: Code[20]; LineNo: Integer; DueDate: Date; LineAmount: Decimal; IsInvoiced: Boolean)
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        ScheduleLine.Init();
        ScheduleLine."Contract No." := LeaseNo;
        ScheduleLine."Line No." := LineNo;
        ScheduleLine."Due Date" := DueDate;
        ScheduleLine.Amount := LineAmount;
        ScheduleLine.Invoiced := IsInvoiced;
        ScheduleLine.Insert();
    end;
}
