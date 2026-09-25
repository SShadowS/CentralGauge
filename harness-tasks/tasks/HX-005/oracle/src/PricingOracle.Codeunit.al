codeunit 85400 "HX005 Pricing Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure DailyWeekdaysUnchanged()
    begin
        SetPricing(25, 1000, 0);
        Assert.AreEqual(120.00, Price('HX5-A', 40, Enum::"CGR Pricing Method"::Daily, 20270301D, 20270303D, 0), 'Mon-Wed: 3 x 40');
    end;

    [Test]
    procedure DailyWeekendSurchargeUnchanged()
    begin
        SetPricing(25, 1000, 0);
        Assert.AreEqual(180.00, Price('HX5-B', 40, Enum::"CGR Pricing Method"::Daily, 20270305D, 20270308D, 0), 'Fri-Mon: 4 x 40 plus 25 percent on Saturday and Sunday');
    end;

    [Test]
    procedure DailyFractionalSurcharge()
    begin
        SetPricing(12.5, 1000, 0);
        Assert.AreEqual(141.65, Price('HX5-C', 33.33, Enum::"CGR Pricing Method"::Daily, 20270305D, 20270308D, 0), '4 x 33.33 plus 2 x 4.16625, rounded once');
    end;

    [Test]
    procedure WeekendPackageUnchanged()
    begin
        SetPricing(25, 1000, 0);
        Assert.AreEqual(80.00, Price('HX5-D', 40, Enum::"CGR Pricing Method"::"Weekend Package", 20270305D, 20270307D, 0), 'Weekend package: 2 x 40');
    end;

    [Test]
    procedure ExcessKmBelowAllowance()
    begin
        SetPricing(0, 100, 0.5);
        Assert.AreEqual(120.00, Price('HX5-E', 40, Enum::"CGR Pricing Method"::Daily, 20270301D, 20270303D, 299), '299 km is below the 300 km allowance');
    end;

    [Test]
    procedure ExcessKmAtAllowance()
    begin
        SetPricing(0, 100, 0.5);
        Assert.AreEqual(120.00, Price('HX5-F', 40, Enum::"CGR Pricing Method"::Daily, 20270301D, 20270303D, 300), '300 km is exactly the allowance');
    end;

    [Test]
    procedure ExcessKmAboveAllowance()
    begin
        SetPricing(0, 100, 0.5);
        Assert.AreEqual(120.50, Price('HX5-G', 40, Enum::"CGR Pricing Method"::Daily, 20270301D, 20270303D, 301), 'One km over the allowance at 0.50');
    end;

    [Test]
    procedure ExcessKmOnWeekendPackage()
    begin
        SetPricing(0, 100, 0.5);
        Assert.AreEqual(130.00, Price('HX5-H', 40, Enum::"CGR Pricing Method"::"Weekend Package", 20270305D, 20270307D, 400), 'Weekend package 80 plus 100 km over at 0.50');
    end;

    [Test]
    procedure PartnerMethodPriceUsed()
    begin
        SetPricing(0, 1000, 0);
        Assert.AreEqual(180.00, Price('HX5-I', 40, Enum::"CGR Pricing Method"::"HX5 Flat Fee", 20270301D, 20270303D, 0), 'Partner method: 40 x 1.5 x 3 days');
    end;

    [Test]
    procedure PartnerMethodGetsExcessKm()
    begin
        SetPricing(0, 100, 0.5);
        Assert.AreEqual(160.00, Price('HX5-J', 40, Enum::"CGR Pricing Method"::"HX5 Flat Fee", 20270301D, 20270301D, 300), 'Partner base 60 plus 200 km over at 0.50');
    end;

    [Test]
    procedure PartnerFractionalRoundedOnce()
    begin
        SetPricing(0, 100, 0.005);
        Assert.AreEqual(50.00, Price('HX5-K', 33.33, Enum::"CGR Pricing Method"::"HX5 Flat Fee", 20270301D, 20270301D, 101), '49.995 plus 0.005, rounded once after the excess charge');
    end;

    [Test]
    procedure DailyFractionalExcessRoundedOnce()
    begin
        SetPricing(12.5, 100, 0.0025);
        Assert.AreEqual(141.66, Price('HX5-M', 33.33, Enum::"CGR Pricing Method"::Daily, 20270305D, 20270308D, 401), '141.6525 plus 0.0025, rounded once after the excess charge');
    end;

    [Test]
    procedure PostingUsesPartnerMethod()
    var
        Contract: Record "CGR Rental Contract";
        Entry: Record "CGR Rental Ledger Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        SetPricing(0, 1000, 0);
        MakeVehicle('HX5-L', 40);
        ContractNo := RentalMgt.CreateContract('HX5-L', 'Oracle Customer', 20270301D, 20270303D);
        Contract.Get(ContractNo);
        Contract."Pricing Method" := Contract."Pricing Method"::"HX5 Flat Fee";
        Contract.Modify();
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1000, '');
        RentalMgt.Post(ContractNo);
        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Entry.Count(), 'Posting creates one ledger entry');
        Entry.FindFirst();
        Assert.AreEqual(180.00, Entry.Amount, 'Posting prices the contract with the partner method');
    end;

    local procedure SetPricing(WeekendSurchargePct: Decimal; KmAllowancePerDay: Integer; ExcessKmRate: Decimal)
    var
        Setup: Record "CGR Setup";
    begin
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := WeekendSurchargePct;
        Setup."Km Allowance per Day" := KmAllowancePerDay;
        Setup."Excess Km Rate" := ExcessKmRate;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
    end;

    local procedure MakeVehicle(VehicleNo: Code[20]; DailyRate: Decimal)
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Contract: Record "CGR Rental Contract";
        Entry: Record "CGR Rental Ledger Entry";
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle."Daily Rate" := DailyRate;
        Vehicle.Insert();
    end;

    local procedure Price(VehicleNo: Code[20]; DailyRate: Decimal; Method: Enum "CGR Pricing Method"; StartDate: Date; EndDate: Date; KmDriven: Integer): Decimal
    var
        Contract: Record "CGR Rental Contract";
        Pricing: Codeunit "CGR Rental Pricing";
    begin
        MakeVehicle(VehicleNo, DailyRate);
        Contract.Init();
        Contract."No." := VehicleNo;
        Contract."Vehicle No." := VehicleNo;
        Contract."Start Date" := StartDate;
        Contract."End Date" := EndDate;
        Contract."Pricing Method" := Method;
        Contract."Start Km" := 1000;
        Contract."Return Km" := 1000 + KmDriven;
        Contract.Status := Contract.Status::Returned;
        Contract.Insert();
        exit(Pricing.CalcAmount(Contract));
    end;
}
