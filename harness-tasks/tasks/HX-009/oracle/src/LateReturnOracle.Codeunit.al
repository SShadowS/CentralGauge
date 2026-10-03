codeunit 85640 "HX009 Late Return Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        LateReturnTxt: Label 'Late return';

    [Test]
    procedure LateWeekdayReturnCharged()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(12.345);
        ClearHolidays();
        InitVehicle('HX009-A');
        ContractNo := ReturnedContract('HX009-A', 20270301D, 20270303D, 20270304D);

        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(2, PreviewLine.Count(), 'Rental days and late return');
        AssertLateLine(PreviewLine, 1, 12.35);
        Assert.AreEqual(162.35, Preview.TotalAmount(PreviewLine), 'Preview total includes the late return line');
    end;

    [Test]
    procedure WeekendDaysNotCounted()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(12.345);
        ClearHolidays();
        InitVehicle('HX009-B');
        ContractNo := ReturnedContract('HX009-B', 20270303D, 20270305D, 20270309D);

        Preview.BuildPreview(ContractNo, PreviewLine);
        AssertLateLine(PreviewLine, 2, 24.69);
        Assert.AreEqual(174.69, Preview.TotalAmount(PreviewLine), 'Monday and Tuesday are charged, the weekend is not');
    end;

    [Test]
    procedure HolidayNotCounted()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(12.345);
        ClearHolidays();
        AddHoliday(20270308D);
        InitVehicle('HX009-C');
        ContractNo := ReturnedContract('HX009-C', 20270303D, 20270305D, 20270309D);

        Preview.BuildPreview(ContractNo, PreviewLine);
        AssertLateLine(PreviewLine, 1, 12.35);
        Assert.AreEqual(162.35, Preview.TotalAmount(PreviewLine), 'Only Tuesday is charged');
    end;

    [Test]
    procedure ReturnOnEndDateHasNoLine()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(12.345);
        ClearHolidays();
        InitVehicle('HX009-D');
        ContractNo := ReturnedContract('HX009-D', 20270303D, 20270305D, 20270305D);

        Preview.BuildPreview(ContractNo, PreviewLine);
        AssertNoLateLine(PreviewLine);
        Assert.AreEqual(1, PreviewLine.Count(), 'Only the rental days line');
        Assert.AreEqual(150.00, Preview.TotalAmount(PreviewLine), 'A return on the end date is not late');
    end;

    [Test]
    procedure WeekendOnlyLatenessHasNoLine()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(12.345);
        ClearHolidays();
        InitVehicle('HX009-E');
        ContractNo := ReturnedContract('HX009-E', 20270303D, 20270305D, 20270307D);

        Preview.BuildPreview(ContractNo, PreviewLine);
        AssertNoLateLine(PreviewLine);
        Assert.AreEqual(1, PreviewLine.Count(), 'Only the rental days line');
        Assert.AreEqual(150.00, Preview.TotalAmount(PreviewLine), 'A weekend after the end date has no working day');
    end;

    [Test]
    procedure PostedFeeUsesReturnDate()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(12.345);
        ClearHolidays();
        InitVehicle('HX009-F');
        ContractNo := ReturnedContract('HX009-F', 20270303D, 20270305D, 20270308D);
        WorkDate(20270315D);

        RentalMgt.Post(ContractNo);
        Assert.AreEqual(162.35, PostedAmount(ContractNo), 'Posted amount charges the Monday of the return only');
    end;

    [Test]
    procedure ReturnRecordsReturnDate()
    var
        Contract: Record "CGR Rental Contract";
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(12.345);
        ClearHolidays();
        InitVehicle('HX009-G');
        ContractNo := ReturnedContract('HX009-G', 20270303D, 20270305D, 20270304D);

        Contract.Get(ContractNo);
        Assert.AreEqual(20270304D, Contract."Return Date", 'Return stores the work date as the return date');
        Preview.BuildPreview(ContractNo, PreviewLine);
        AssertNoLateLine(PreviewLine);
        Assert.AreEqual(1, PreviewLine.Count(), 'An early return has no late return line');
    end;

    [Test]
    procedure ZeroFeeHasNoLine()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0);
        ClearHolidays();
        InitVehicle('HX009-H');
        ContractNo := ReturnedContract('HX009-H', 20270301D, 20270303D, 20270305D);

        Preview.BuildPreview(ContractNo, PreviewLine);
        AssertNoLateLine(PreviewLine);
        Assert.AreEqual(1, PreviewLine.Count(), 'Only the rental days line');
        Assert.AreEqual(150.00, Preview.TotalAmount(PreviewLine), 'No fee without a late fee per day');
    end;

    [Test]
    procedure BatchPostedFeeIncluded()
    var
        Contract: Record "CGR Rental Contract";
        BatchPost: Codeunit "CGR Rental Batch Post";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(12.345);
        ClearHolidays();
        InitVehicle('HX009-I');
        ContractNo := ReturnedContract('HX009-I', 20270303D, 20270305D, 20270308D);
        WorkDate(20270312D);

        Contract.SetRange("Vehicle No.", 'HX009-I');
        Assert.AreEqual(1, BatchPost.PostBatch(Contract), 'The returned contract is posted');
        Assert.AreEqual(162.35, PostedAmount(ContractNo), 'Batch posting charges the Monday of the return only');
    end;

    [Test]
    procedure WeekendPackageAlsoCharged()
    var
        Contract: Record "CGR Rental Contract";
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(12.345);
        ClearHolidays();
        InitVehicle('HX009-J');
        ContractNo := ReturnedContract('HX009-J', 20270305D, 20270307D, 20270309D);
        Contract.Get(ContractNo);
        Contract."Pricing Method" := Contract."Pricing Method"::"Weekend Package";
        Contract.Modify();

        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(2, PreviewLine.Count(), 'Weekend package and late return');
        PreviewLine.SetRange(Description, 'Weekend package');
        Assert.AreEqual(1, PreviewLine.Count(), 'One weekend package line');
        PreviewLine.FindFirst();
        Assert.AreEqual(100.00, PreviewLine.Amount, 'Two daily rates');
        PreviewLine.SetRange(Description);
        AssertLateLine(PreviewLine, 2, 24.69);
        Assert.AreEqual(124.69, Preview.TotalAmount(PreviewLine), 'Package plus late return');
    end;

    [Test]
    procedure LateLineUsesSetupPrecision()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetupAtPrecision(12.345, 1);
        ClearHolidays();
        InitVehicle('HX009-K');
        ContractNo := ReturnedContract('HX009-K', 20270303D, 20270305D, 20270308D);

        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(2, PreviewLine.Count(), 'Rental days and late return');
        AssertLateLine(PreviewLine, 1, 12);
        Assert.AreEqual(162, Preview.TotalAmount(PreviewLine), 'Rental days 150 plus the late return line at whole units');
    end;

    local procedure InitSetup(LateFeePerDay: Decimal)
    begin
        InitSetupAtPrecision(LateFeePerDay, 0.01);
    end;

    local procedure InitSetupAtPrecision(LateFeePerDay: Decimal; RoundingPrecision: Decimal)
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := 0;
        Setup."Km Allowance per Day" := 1000;
        Setup."Excess Km Rate" := 0;
        Setup."Suspend Rentals" := false;
        Setup."Amount Rounding Precision" := RoundingPrecision;
        Setup."Default Branch Code" := '';
        Setup."Late Fee per Day" := LateFeePerDay;
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
        NonWorkingDay.Description := 'HX009 holiday';
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

    local procedure ReturnedContract(VehicleNo: Code[20]; StartDate: Date; EndDate: Date; ReturnDate: Date): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX009 Customer', StartDate, EndDate);
        RentalMgt.CheckOut(ContractNo);
        WorkDate(ReturnDate);
        RentalMgt.Return(ContractNo, 1100, '');
        exit(ContractNo);
    end;

    local procedure AssertLateLine(var PreviewLine: Record "CGR Invoice Preview Line"; ExpectedQuantity: Decimal; ExpectedAmount: Decimal)
    begin
        PreviewLine.SetRange(Description, LateReturnTxt);
        Assert.AreEqual(1, PreviewLine.Count(), 'One late return line');
        PreviewLine.FindFirst();
        Assert.AreEqual(ExpectedQuantity, PreviewLine.Quantity, 'Late return quantity is the number of late working days');
        Assert.AreEqual(12.345, PreviewLine."Unit Price", 'Late return unit price is the late fee per day');
        Assert.AreEqual(ExpectedAmount, PreviewLine.Amount, 'Late return amount is rounded like the other lines');
        PreviewLine.SetRange(Description);
    end;

    local procedure AssertNoLateLine(var PreviewLine: Record "CGR Invoice Preview Line")
    begin
        PreviewLine.SetRange(Description, LateReturnTxt);
        Assert.AreEqual(0, PreviewLine.Count(), 'No late return line');
        PreviewLine.SetRange(Description);
    end;

    local procedure PostedAmount(ContractNo: Code[20]): Decimal
    var
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, LedgerEntry.Count(), 'One ledger entry per posted contract');
        LedgerEntry.FindFirst();
        exit(LedgerEntry.Amount);
    end;
}
