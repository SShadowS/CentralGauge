codeunit 86860 "HX070 Start Charge Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure MidMonthStart()
    begin
        PrepareHX070();
        InitHX070Lease('HX070-1', 20270316D, 3, 100);
        AssertHX070Charge('HX070-1', 53.16, '103.00 x 16 / 31 days of March');
    end;

    [Test]
    procedure FirstOfMonthFullRate()
    begin
        PrepareHX070();
        InitHX070Lease('HX070-2', 20270301D, 3, 100);
        AssertHX070Charge('HX070-2', 103.00, 'A lease starting on the 1st pays the full monthly rate');
    end;

    [Test]
    procedure LastDayOfMonth()
    begin
        PrepareHX070();
        InitHX070Lease('HX070-3', 20270331D, 3, 100);
        AssertHX070Charge('HX070-3', 3.32, '103.00 x 1 / 31 days of March');
    end;

    [Test]
    procedure ShortFebruary()
    begin
        PrepareHX070();
        InitHX070Lease('HX070-4', 20270215D, 3, 100);
        AssertHX070Charge('HX070-4', 51.50, '103.00 x 14 / 28 days of February 2027');
    end;

    [Test]
    procedure LeapFebruary()
    begin
        PrepareHX070();
        InitHX070Lease('HX070-5', 20280215D, 3, 100);
        AssertHX070Charge('HX070-5', 53.28, '103.00 x 15 / 29 days of February 2028');
    end;

    [Test]
    procedure ThirtyDayMonth()
    begin
        PrepareHX070();
        InitHX070Lease('HX070-6', 20270421D, 3, 100);
        AssertHX070Charge('HX070-6', 34.33, '103.00 x 10 / 30 days of April');
    end;

    [Test]
    procedure OtherDurationAndBase()
    begin
        PrepareHX070();
        InitHX070Lease('HX070-7', 20270520D, 12, 250);
        AssertHX070Charge('HX070-7', 108.39, '280.00 (250 x 1.12) x 12 / 31 days of May');
    end;

    [Test]
    procedure MissingLeaseRaises()
    var
        Contract: Record "CGR Lease Contract";
        Runner: Codeunit "HX070 Charge Runner";
        Ok: Boolean;
    begin
        PrepareHX070();
        RemoveHX070Lease('HX070-NONE');
        Assert.IsFalse(Contract.Get('HX070-NONE'), 'Precondition: lease HX070-NONE does not exist');
        Commit();

        Runner.SetHX070Contract('HX070-NONE');
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'The first installment of a lease that does not exist fails');
        Assert.AreEqual('The CGR Lease Contract does not exist. Identification fields and values: No.=''HX070-NONE''', GetLastErrorText(), 'The not-found error reaches the caller');
    end;

    local procedure AssertHX070Charge(LeaseNo: Code[20]; Expected: Decimal; Why: Text)
    var
        StartCharge: Codeunit "CGR Lease Start Charge";
    begin
        Assert.AreEqual(Expected, StartCharge.FirstInstallment(LeaseNo), StrSubstNo('First installment of %1: %2', LeaseNo, Why));
    end;

    local procedure PrepareHX070()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure RemoveHX070Lease(LeaseNo: Code[20])
    var
        Contract: Record "CGR Lease Contract";
    begin
        if Contract.Get(LeaseNo) then
            Contract.Delete();
    end;

    local procedure InitHX070Lease(LeaseNo: Code[20]; StartDate: Date; Months: Integer; BaseRate: Decimal)
    var
        Contract: Record "CGR Lease Contract";
    begin
        RemoveHX070Lease(LeaseNo);
        Contract.Init();
        Contract."No." := LeaseNo;
        Contract."Vehicle No." := 'HX070-V';
        Contract."Customer Name" := 'HX070 Customer';
        Contract."Start Date" := StartDate;
        Contract.Months := Months;
        Contract."Base Rate" := BaseRate;
        Contract.Insert();
    end;
}
