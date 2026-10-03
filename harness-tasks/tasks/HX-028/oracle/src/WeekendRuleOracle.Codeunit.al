codeunit 86020 "HX028 Weekend Rule Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        RentalDaysTxt: Label 'Rental days';
        WeekendSurchargeTxt: Label 'Weekend surcharge';
        WeekendPackageTxt: Label 'Weekend package';

    [Test]
    procedure SaturdayAndSundayAreWeekend()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        WorkDate(20270301D);
        InitSetup();
        ClearHolidays();
        Assert.IsTrue(WorkingDays.IsWeekend(20270306D), 'Saturday 2027-03-06 is weekend');
        Assert.IsTrue(WorkingDays.IsWeekend(20270307D), 'Sunday 2027-03-07 is weekend');
        Assert.IsTrue(WorkingDays.IsWeekend(20270327D), 'Saturday 2027-03-27 is weekend');
        Assert.IsTrue(WorkingDays.IsWeekend(20270328D), 'Sunday 2027-03-28 is weekend');
    end;

    [Test]
    procedure WeekdaysAreNotWeekend()
    var
        WorkingDays: Codeunit "CGR Working Days";
        DayOffset: Integer;
    begin
        WorkDate(20270301D);
        InitSetup();
        ClearHolidays();
        for DayOffset := 0 to 4 do
            Assert.IsFalse(WorkingDays.IsWeekend(20270301D + DayOffset), StrSubstNo('%1 (Monday to Friday) is not weekend', Format(20270301D + DayOffset, 0, 9)));
        Assert.IsFalse(WorkingDays.IsWeekend(20270308D), 'Monday 2027-03-08 after the weekend is not weekend');
    end;

    [Test]
    procedure WeekdayHolidayIsNotWeekend()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        WorkDate(20270301D);
        InitSetup();
        ClearHolidays();
        AddHoliday(20270310D);
        AddHoliday(20270312D);
        Assert.IsFalse(WorkingDays.IsWeekend(20270310D), 'A non-working Wednesday is not weekend');
        Assert.IsFalse(WorkingDays.IsWeekend(20270312D), 'A non-working Friday is not weekend');
    end;

    [Test]
    procedure WeekendHolidayIsWeekend()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        WorkDate(20270301D);
        InitSetup();
        ClearHolidays();
        AddHoliday(20270313D);
        AddHoliday(20270314D);
        Assert.IsTrue(WorkingDays.IsWeekend(20270313D), 'A non-working Saturday is still weekend');
        Assert.IsTrue(WorkingDays.IsWeekend(20270314D), 'A non-working Sunday is still weekend');
    end;

    [Test]
    procedure SurchargeIgnoresWeekdayHoliday()
    var
        Contract: Record "CGR Rental Contract";
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        Pricing: Codeunit "CGR Rental Pricing";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup();
        ClearHolidays();
        AddHoliday(20270305D);
        InitVehicle('HX028-R5');
        ContractNo := ReturnedContract('HX028-R5', 20270304D, 20270307D);

        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(2, PreviewLine.Count(), 'Rental days and weekend surcharge');
        AssertLine(PreviewLine, RentalDaysTxt, 4, 50, 200);
        AssertLine(PreviewLine, WeekendSurchargeTxt, 2, 25, 50);
        Assert.AreEqual(250, Preview.TotalAmount(PreviewLine), 'Preview total: 4 x 50 plus Saturday and Sunday at 25');
        Contract.Get(ContractNo);
        Assert.AreEqual(250, Pricing.CalcAmount(Contract), 'Posted price: the non-working Friday carries no surcharge');
    end;

    [Test]
    procedure WorkingDaysUnchanged()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        WorkDate(20270301D);
        InitSetup();
        ClearHolidays();
        AddHoliday(20270310D);
        Assert.AreEqual(9, WorkingDays.WorkingDaysBetween(20270301D, 20270314D), 'Ten weekdays minus the non-working Wednesday');
        Assert.IsFalse(WorkingDays.IsWorkingDay(20270310D), 'The non-working Wednesday is not a working day');
        Assert.IsTrue(WorkingDays.IsWorkingDay(20270311D), 'Thursday is a working day');
        Assert.IsFalse(WorkingDays.IsWorkingDay(20270313D), 'Saturday is not a working day');
        Assert.AreEqual(20270311D, WorkingDays.NextWorkingDay(20270309D), 'Tuesday is followed by Thursday, past the non-working Wednesday');
        Assert.AreEqual(20270315D, WorkingDays.NextWorkingDay(20270312D), 'Friday is followed by Monday');
    end;

    [Test]
    procedure PackageUnchanged()
    var
        Contract: Record "CGR Rental Contract";
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        Pricing: Codeunit "CGR Rental Pricing";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup();
        ClearHolidays();
        AddHoliday(20270305D);
        InitVehicle('HX028-R7');
        ContractNo := ReturnedContract('HX028-R7', 20270305D, 20270307D);
        Contract.Get(ContractNo);
        Contract."Pricing Method" := Contract."Pricing Method"::"Weekend Package";
        Contract.Modify();

        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(1, PreviewLine.Count(), 'One package line, no weekend surcharge');
        AssertLine(PreviewLine, WeekendPackageTxt, 1, 100, 100);
        Contract.Get(ContractNo);
        Assert.AreEqual(100, Pricing.CalcAmount(Contract), 'Posted price: two daily rates');
    end;

    [Test]
    procedure SurchargeCountsWeekendHoliday()
    var
        Contract: Record "CGR Rental Contract";
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        Pricing: Codeunit "CGR Rental Pricing";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup();
        ClearHolidays();
        AddHoliday(20270313D);
        InitVehicle('HX028-R8');
        ContractNo := ReturnedContract('HX028-R8', 20270312D, 20270314D);

        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(2, PreviewLine.Count(), 'Rental days and weekend surcharge');
        AssertLine(PreviewLine, RentalDaysTxt, 3, 50, 150);
        AssertLine(PreviewLine, WeekendSurchargeTxt, 2, 25, 50);
        Assert.AreEqual(200, Preview.TotalAmount(PreviewLine), 'Preview total: 3 x 50 plus Saturday and Sunday at 25');
        Contract.Get(ContractNo);
        Assert.AreEqual(200, Pricing.CalcAmount(Contract), 'Posted price: the non-working Saturday keeps its surcharge');
    end;

    local procedure InitSetup()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := 50;
        Setup."Km Allowance per Day" := 1000;
        Setup."Excess Km Rate" := 0;
        Setup."Suspend Rentals" := false;
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure ClearHolidays()
    var
        NonWorkingDay: Record "CGR Non-Working Day";
    begin
        NonWorkingDay.SetRange("Non-Working Date", 20270301D, 20270331D);
        NonWorkingDay.DeleteAll();
    end;

    local procedure AddHoliday(NonWorkingDate: Date)
    var
        NonWorkingDay: Record "CGR Non-Working Day";
    begin
        NonWorkingDay.Init();
        NonWorkingDay."Non-Working Date" := NonWorkingDate;
        NonWorkingDay.Description := 'HX028 holiday';
        NonWorkingDay.Insert();
    end;

    local procedure InitVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.SetRange("Vehicle No.", VehicleNo);
        LedgerEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle."Daily Rate" := 50;
        Vehicle.Insert();
    end;

    local procedure ReturnedContract(VehicleNo: Code[20]; StartDate: Date; EndDate: Date): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX028 Customer', StartDate, EndDate);
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1100, '');
        exit(ContractNo);
    end;

    local procedure AssertLine(var PreviewLine: Record "CGR Invoice Preview Line"; LineDescription: Text; ExpectedQuantity: Decimal; ExpectedUnitPrice: Decimal; ExpectedAmount: Decimal)
    begin
        PreviewLine.SetRange(Description, LineDescription);
        Assert.AreEqual(1, PreviewLine.Count(), StrSubstNo('One %1 line', LineDescription));
        PreviewLine.FindFirst();
        Assert.AreEqual(ExpectedQuantity, PreviewLine.Quantity, StrSubstNo('%1 quantity', LineDescription));
        Assert.AreEqual(ExpectedUnitPrice, PreviewLine."Unit Price", StrSubstNo('%1 unit price', LineDescription));
        Assert.AreEqual(ExpectedAmount, PreviewLine.Amount, StrSubstNo('%1 amount', LineDescription));
        PreviewLine.SetRange(Description);
    end;
}
