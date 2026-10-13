codeunit 86180 "HX036 Rate Card Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        RentalDaysTxt: Label 'Rental days';
        WeekendPackageTxt: Label 'Weekend package';

    [Test]
    procedure OpenEndedRateApplies()
    begin
        Prepare('HX036-V1');
        AddRate('HX036-V1', 20260101D, 0D, 50);
        AssertDailyPrice('HX036-V1', 'HX036-C1', 50, 'An open-ended rate valid since 2026-01-01 applies');
    end;

    [Test]
    procedure LatestStartingRateWins()
    begin
        Prepare('HX036-V2');
        AddRate('HX036-V2', 20260101D, 0D, 50);
        AddRate('HX036-V2', 20270301D, 0D, 60);
        AssertDailyPrice('HX036-V2', 'HX036-C2', 60, 'Of two valid rates, the one starting 2027-03-01 applies');
    end;

    [Test]
    procedure ExpiredRateIgnored()
    begin
        Prepare('HX036-V3');
        AddRate('HX036-V3', 20270101D, 20270228D, 55);
        AssertDailyPrice('HX036-V3', 'HX036-C3', 45, 'A rate that ended on 2027-02-28 does not apply; the vehicle rate is used');
    end;

    [Test]
    procedure RateEndingOnStartDateApplies()
    begin
        Prepare('HX036-V4');
        AddRate('HX036-V4', 20270201D, 20270304D, 70);
        AssertDailyPrice('HX036-V4', 'HX036-C4', 70, 'A rate ending on the contract start date 2027-03-04 applies');
    end;

    [Test]
    procedure LaterRateNotUsedForContract()
    begin
        Prepare('HX036-V5');
        AddRate('HX036-V5', 20270305D, 0D, 80);
        AssertDailyPrice('HX036-V5', 'HX036-C5', 45, 'A rate starting after the contract start date does not apply; the vehicle rate is used');
    end;

    [Test]
    procedure NoRateUsesVehicleRate()
    begin
        Prepare('HX036-V6');
        AssertDailyPrice('HX036-V6', 'HX036-C6', 45, 'Without a rate on the rate card the vehicle rate is used');
    end;

    [Test]
    procedure RateStartingOnStartDateApplies()
    begin
        Prepare('HX036-V8');
        AddRate('HX036-V8', 20260101D, 0D, 50);
        AddRate('HX036-V8', 20270304D, 0D, 75);
        AssertDailyPrice('HX036-V8', 'HX036-C8', 75, 'A rate starting on the contract start date 2027-03-04 applies and is the latest valid rate');
    end;

    [Test]
    procedure MixedValidRatesLatestWins()
    begin
        Prepare('HX036-V9');
        AddRate('HX036-V9', 20260101D, 0D, 50);
        AddRate('HX036-V9', 20270201D, 20270331D, 65);
        AssertDailyPrice('HX036-V9', 'HX036-C9', 65, 'Of an open-ended rate from 2026-01-01 and a rate 2027-02-01..2027-03-31, the later starting one applies');
    end;

    [Test]
    procedure PackageUsesRate()
    var
        Contract: Record "CGR Rental Contract";
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        Pricing: Codeunit "CGR Rental Pricing";
    begin
        Prepare('HX036-V7');
        AddRate('HX036-V7', 20270301D, 0D, 60);
        InsertReturnedContract('HX036-C7', 'HX036-V7', Enum::"CGR Pricing Method"::"Weekend Package");

        Contract.Get('HX036-C7');
        Assert.AreEqual(120.00, Pricing.CalcAmount(Contract), 'Weekend package price: 2 x the applicable rate 60');
        Preview.BuildPreview('HX036-C7', PreviewLine);
        Assert.AreEqual(1, PreviewLine.Count(), 'The preview of a weekend package has one line');
        AssertLine(PreviewLine, WeekendPackageTxt, 1, 120);
    end;

    local procedure AssertDailyPrice(VehicleNo: Code[20]; ContractNo: Code[20]; ExpectedRate: Decimal; Context: Text)
    var
        Contract: Record "CGR Rental Contract";
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        Pricing: Codeunit "CGR Rental Pricing";
    begin
        InsertReturnedContract(ContractNo, VehicleNo, Enum::"CGR Pricing Method"::Daily);

        Contract.Get(ContractNo);
        Assert.AreEqual(3 * ExpectedRate, Pricing.CalcAmount(Contract), StrSubstNo('Price of 3 days: %1', Context));
        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(1, PreviewLine.Count(), 'The preview has only the Rental days line');
        AssertLine(PreviewLine, RentalDaysTxt, 3, ExpectedRate);
    end;

    local procedure AssertLine(var PreviewLine: Record "CGR Invoice Preview Line"; LineDescription: Text; ExpectedQuantity: Decimal; ExpectedUnitPrice: Decimal)
    begin
        PreviewLine.SetRange(Description, LineDescription);
        Assert.AreEqual(1, PreviewLine.Count(), StrSubstNo('One %1 line', LineDescription));
        PreviewLine.FindFirst();
        Assert.AreEqual(ExpectedQuantity, PreviewLine.Quantity, StrSubstNo('%1 quantity', LineDescription));
        Assert.AreEqual(ExpectedUnitPrice, PreviewLine."Unit Price", StrSubstNo('%1 unit price', LineDescription));
        PreviewLine.SetRange(Description);
    end;

    local procedure Prepare(VehicleNo: Code[20])
    begin
        WorkDate(20270301D);
        InitSetup();
        InitVehicle(VehicleNo);
    end;

    local procedure InitSetup()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := 0;
        Setup."Km Allowance per Day" := 1000;
        Setup."Excess Km Rate" := 0;
        Setup."Suspend Rentals" := false;
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure InitVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        VehicleRate: Record "CGR Vehicle Rate";
        Contract: Record "CGR Rental Contract";
    begin
        VehicleRate.SetRange("Vehicle No.", VehicleNo);
        VehicleRate.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle."Daily Rate" := 45;
        Vehicle.Insert();
    end;

    local procedure AddRate(VehicleNo: Code[20]; StartingDate: Date; EndingDate: Date; DailyRate: Decimal)
    var
        VehicleRate: Record "CGR Vehicle Rate";
    begin
        VehicleRate.Init();
        VehicleRate."Vehicle No." := VehicleNo;
        VehicleRate."Starting Date" := StartingDate;
        VehicleRate."Ending Date" := EndingDate;
        VehicleRate."Daily Rate" := DailyRate;
        VehicleRate.Insert();
    end;

    local procedure InsertReturnedContract(ContractNo: Code[20]; VehicleNo: Code[20]; Method: Enum "CGR Pricing Method")
    var
        Contract: Record "CGR Rental Contract";
    begin
        if Contract.Get(ContractNo) then
            Contract.Delete();
        Contract.Init();
        Contract."No." := ContractNo;
        Contract."Vehicle No." := VehicleNo;
        Contract."Customer Name" := 'HX036 Customer';
        Contract."Start Date" := 20270304D;
        Contract."End Date" := 20270306D;
        Contract."Pricing Method" := Method;
        Contract."Start Km" := 1000;
        Contract."Return Km" := 1000;
        Contract.Status := Contract.Status::Returned;
        Contract.Insert();
    end;
}
