codeunit 80053 "CGR Invoice Preview Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure DailyPreviewMatchesPricing()
    var
        Contract: Record "CGR Rental Contract";
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        Pricing: Codeunit "CGR Rental Pricing";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(50, 100, 0.5);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-PRV-001', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PRV-001', 50);
        ContractNo := Lib.CreateReturnedContract('T-PRV-001', 20270305D, 20270307D, 1450);

        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(3, PreviewLine.Count(), 'Rental days, weekend surcharge and excess km');

        PreviewLine.FindSet();
        Assert.AreEqual('Rental days', PreviewLine.Description, 'First line');
        Assert.AreEqual(3.0, PreviewLine.Quantity, 'Three rental days');
        Assert.AreEqual(150.00, PreviewLine.Amount, '3 x 50');
        PreviewLine.Next();
        Assert.AreEqual('Weekend surcharge', PreviewLine.Description, 'Second line');
        Assert.AreEqual(2.0, PreviewLine.Quantity, 'Saturday and Sunday');
        Assert.AreEqual(25.00, PreviewLine."Unit Price", '50 percent of 50');
        Assert.AreEqual(50.00, PreviewLine.Amount, '2 x 25');
        PreviewLine.Next();
        Assert.AreEqual('Excess km', PreviewLine.Description, 'Third line');
        Assert.AreEqual(150.0, PreviewLine.Quantity, '450 km driven against a 300 km allowance');
        Assert.AreEqual(75.00, PreviewLine.Amount, '150 x 0.50');

        Contract.Get(ContractNo);
        Assert.AreEqual(275.00, Preview.TotalAmount(PreviewLine), 'Preview total');
        Assert.AreEqual(Pricing.CalcAmount(Contract), Preview.TotalAmount(PreviewLine), 'Preview total equals the posted price');
    end;

    [Test]
    procedure RebuildReplacesPreviousLines()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(0, 1000, 0);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-PRV-002', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PRV-002', 40);
        ContractNo := Lib.CreateReturnedContract('T-PRV-002', 20270301D, 20270303D, 1100);

        Preview.BuildPreview(ContractNo, PreviewLine);
        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(1, PreviewLine.Count(), 'A rebuild replaces the lines');
        Assert.AreEqual(120.00, Preview.TotalAmount(PreviewLine), '3 x 40');
    end;

    [Test]
    procedure LineAmountsUseSetupPrecision()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(0, 1000, 0);
        Lib.SetV2Setup(1, '', 3);
        Lib.CreateVehicle('T-PRV-003', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PRV-003', 33.33);
        ContractNo := Lib.CreateReturnedContract('T-PRV-003', 20270301D, 20270303D, 1000);

        Preview.BuildPreview(ContractNo, PreviewLine);
        PreviewLine.FindFirst();
        Assert.AreEqual(33.33, PreviewLine."Unit Price", 'Unit price is not rounded');
        Assert.AreEqual(100.00, PreviewLine.Amount, '3 x 33.33 rounded to whole units');
    end;

    [Test]
    procedure WeekendPackageIsOneLine()
    var
        Contract: Record "CGR Rental Contract";
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(50, 1000, 0);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-PRV-004', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PRV-004', 40);
        ContractNo := Lib.CreateReturnedContract('T-PRV-004', 20270305D, 20270307D, 1100);
        Contract.Get(ContractNo);
        Contract."Pricing Method" := Contract."Pricing Method"::"Weekend Package";
        Contract.Modify();

        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(1, PreviewLine.Count(), 'One package line');
        PreviewLine.FindFirst();
        Assert.AreEqual('Weekend package', PreviewLine.Description, 'Package line');
        Assert.AreEqual(80.00, PreviewLine.Amount, 'Two daily rates');
    end;
}
