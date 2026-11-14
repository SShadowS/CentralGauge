codeunit 88615 "HX177 Activity Log Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure RunLogsEachInvoiceLine()
    var
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InitHX177();
        SeedHX177Lease('HX177-A', 100.25);

        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('HX177-A', 20270228D), 'January and February are invoiced');

        Assert.AreEqual(2, HX177EntryCount('HX177-A'), 'One activity entry per created invoice line');
        AssertHX177Entry('HX177-A', 10000, 100.25);
        AssertHX177Entry('HX177-A', 20000, 110.25);
        Assert.AreEqual(0, HX177RefCount('HX177-A', 30000), 'March is not invoiced and not logged');
    end;

    [Test]
    procedure OtherAppInsertIsLogged()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
    begin
        InitHX177();
        SeedHX177Lease('HX177-B', 200.10);

        InvoiceLine.Init();
        InvoiceLine."Contract No." := 'HX177-B';
        InvoiceLine."Schedule Line No." := 50000;
        InvoiceLine."Vehicle No." := 'HX177-VB';
        InvoiceLine."Customer Name" := 'Other App Customer';
        InvoiceLine."Due Date" := 20270215D;
        InvoiceLine."Invoice Date" := 20270215D;
        InvoiceLine.Amount := 75.40;
        InvoiceLine.Insert(true);

        Assert.AreEqual(1, HX177EntryCount('HX177-B'), 'An invoice line inserted by another app is logged once');
        AssertHX177Entry('HX177-B', 50000, 75.40);
    end;

    [Test]
    procedure PreviewLeavesLogUnchanged()
    var
        Preview: Record "CGR Lease Invoice Line" temporary;
        InvoiceLine: Record "CGR Lease Invoice Line";
        Entry: Record "CGR Lease Activity Entry";
        BillingPreview: Codeunit "CGR Lease Billing Preview";
    begin
        InitHX177();
        SeedHX177Lease('HX177-C', 300.10);
        Entry.Init();
        Entry."Contract No." := 'HX177-C';
        Entry.Activity := 'INVOICE LINE';
        Entry."Reference No." := 90000;
        Entry.Amount := 5;
        Entry.Insert();

        BillingPreview.PreviewBilling('HX177-C', 20270331D, Preview);

        Assert.AreEqual(3, Preview.Count(), 'The preview lists the three due lines');
        Assert.IsTrue(Preview.Get('HX177-C', 30000), 'The preview lists the March line');
        Assert.AreEqual(320.10, Preview.Amount, 'The preview shows the March amount');
        InvoiceLine.SetRange("Contract No.", 'HX177-C');
        Assert.AreEqual(0, InvoiceLine.Count(), 'The preview creates no invoice line');
        Assert.AreEqual(1, HX177EntryCount('HX177-C'), 'Running the preview leaves the activity log as it was');
        Assert.AreEqual(1, HX177RefCount('HX177-C', 90000), 'The earlier entry is still there');
        Entry.Reset();
        Entry.SetRange("Contract No.", 'HX177-C');
        Entry.FindFirst();
        Assert.AreEqual(5, Entry.Amount, 'The earlier entry is unchanged');
    end;

    [Test]
    procedure PreviewThenRunLogsOnlyTheRun()
    var
        Preview: Record "CGR Lease Invoice Line" temporary;
        BillingPreview: Codeunit "CGR Lease Billing Preview";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InitHX177();
        SeedHX177Lease('HX177-D', 400.30);

        BillingPreview.PreviewBilling('HX177-D', 20270331D, Preview);
        Assert.AreEqual(3, Preview.Count(), 'The quarter preview lists three lines');
        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('HX177-D', 20270228D), 'The run invoices January and February');

        Assert.AreEqual(2, HX177EntryCount('HX177-D'), 'Only the two invoiced lines are logged');
        AssertHX177Entry('HX177-D', 10000, 400.30);
        AssertHX177Entry('HX177-D', 20000, 410.30);
        Assert.AreEqual(0, HX177RefCount('HX177-D', 30000), 'The March line was only previewed and is not logged');
    end;

    local procedure InitHX177()
    var
        Setup: Record "CGR Setup";
        NonWorkingDay: Record "CGR Non-Working Day";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup.Modify();
        SessionContext.Reset();
        NonWorkingDay.SetRange("Non-Working Date", 20270101D, 20270430D);
        NonWorkingDay.DeleteAll();
    end;

    local procedure SeedHX177Lease(LeaseNo: Code[20]; FirstAmount: Decimal)
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        InvoiceLine: Record "CGR Lease Invoice Line";
        Entry: Record "CGR Lease Activity Entry";
        i: Integer;
    begin
        InvoiceLine.SetRange("Contract No.", LeaseNo);
        InvoiceLine.DeleteAll();
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        ScheduleLine.DeleteAll();
        Entry.SetRange("Contract No.", LeaseNo);
        Entry.DeleteAll();
        if Contract.Get(LeaseNo) then
            Contract.Delete();

        Contract.Init();
        Contract."No." := LeaseNo;
        Contract."Vehicle No." := CopyStr('V' + LeaseNo, 1, MaxStrLen(Contract."Vehicle No."));
        Contract."Customer Name" := 'HX177 Customer';
        Contract."Start Date" := 20270115D;
        Contract.Months := 3;
        Contract."Base Rate" := FirstAmount;
        Contract.Insert();
        for i := 1 to 3 do begin
            ScheduleLine.Init();
            ScheduleLine."Contract No." := LeaseNo;
            ScheduleLine."Line No." := i * 10000;
            ScheduleLine."Due Date" := DMY2Date(15, i, 2027);
            ScheduleLine.Amount := FirstAmount + (i - 1) * 10;
            ScheduleLine.Insert();
        end;
    end;

    local procedure HX177EntryCount(LeaseNo: Code[20]): Integer
    var
        Entry: Record "CGR Lease Activity Entry";
    begin
        Entry.SetRange("Contract No.", LeaseNo);
        exit(Entry.Count());
    end;

    local procedure HX177RefCount(LeaseNo: Code[20]; ReferenceNo: Integer): Integer
    var
        Entry: Record "CGR Lease Activity Entry";
    begin
        Entry.SetRange("Contract No.", LeaseNo);
        Entry.SetRange("Reference No.", ReferenceNo);
        exit(Entry.Count());
    end;

    local procedure AssertHX177Entry(LeaseNo: Code[20]; ReferenceNo: Integer; ExpectedAmount: Decimal)
    var
        Entry: Record "CGR Lease Activity Entry";
    begin
        Entry.SetRange("Contract No.", LeaseNo);
        Entry.SetRange("Reference No.", ReferenceNo);
        Assert.AreEqual(1, Entry.Count(), StrSubstNo('Lease %1 line %2 is logged once', LeaseNo, ReferenceNo));
        Entry.FindFirst();
        Assert.AreEqual('INVOICE LINE', Entry.Activity, StrSubstNo('Lease %1 line %2 activity', LeaseNo, ReferenceNo));
        Assert.AreEqual(ExpectedAmount, Entry.Amount, StrSubstNo('Lease %1 line %2 amount', LeaseNo, ReferenceNo));
    end;
}
