codeunit 80082 "CGR Preview Price Naive Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure DailyPreviewHasThreeLines()
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
        Lib.CreateVehicle('T-PPN-001', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PPN-001', 50);
        ContractNo := Lib.CreateReturnedContract('T-PPN-001', 20270305D, 20270307D, 1450);

        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(3, PreviewLine.Count(), 'Rental days, weekend surcharge and excess km');
        PreviewLine.FindSet();
        Assert.AreEqual(150.00, PreviewLine.Amount, '3 x 50');
        PreviewLine.Next();
        Assert.AreEqual(50.00, PreviewLine.Amount, '2 x 25');
        PreviewLine.Next();
        Assert.AreEqual(75.00, PreviewLine.Amount, '150 x 0.50');

        Contract.Get(ContractNo);
        Assert.AreEqual(275.00, Preview.TotalAmount(PreviewLine), 'Preview total');
        Assert.AreEqual(Pricing.CalcAmount(Contract), Preview.TotalAmount(PreviewLine), 'Preview total equals the posted price');
    end;

    [Test]
    procedure CoarsePrecisionRoundsEachLine()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(50, 100, 0.33);
        Lib.SetV2Setup(0.05, '', 3);
        Lib.CreateVehicle('T-PPN-002', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PPN-002', 33.33);
        ContractNo := Lib.CreateReturnedContract('T-PPN-002', 20270305D, 20270307D, 1307);

        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(135.65, Preview.TotalAmount(PreviewLine), 'Sum of the rounded lines');
    end;

    [Test]
    procedure SecondBuildReplacesLines()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(0, 1000, 0);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-PPN-003', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PPN-003', 40);
        ContractNo := Lib.CreateReturnedContract('T-PPN-003', 20270301D, 20270303D, 1100);

        Preview.BuildPreview(ContractNo, PreviewLine);
        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(1, PreviewLine.Count(), 'A rebuild replaces the lines');
        Assert.AreEqual(120.00, Preview.TotalAmount(PreviewLine), '3 x 40');
    end;

    [Test]
    procedure WholeUnitPrecision()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(0, 1000, 0);
        Lib.SetV2Setup(1, '', 3);
        Lib.CreateVehicle('T-PPN-004', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PPN-004', 33.33);
        ContractNo := Lib.CreateReturnedContract('T-PPN-004', 20270301D, 20270303D, 1000);

        Preview.BuildPreview(ContractNo, PreviewLine);
        PreviewLine.FindFirst();
        Assert.AreEqual(100.00, PreviewLine.Amount, '3 x 33.33 rounded to whole units');
    end;

    [Test]
    procedure WeekendPackageSingleLine()
    var
        Contract: Record "CGR Rental Contract";
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(50, 1000, 0);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-PPN-005', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PPN-005', 40);
        ContractNo := Lib.CreateReturnedContract('T-PPN-005', 20270305D, 20270307D, 1100);
        Contract.Get(ContractNo);
        Contract."Pricing Method" := Contract."Pricing Method"::"Weekend Package";
        Contract.Modify();

        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(1, PreviewLine.Count(), 'One package line');
        PreviewLine.FindFirst();
        Assert.AreEqual(80.00, PreviewLine.Amount, 'Two daily rates');
    end;

    [Test]
    procedure FilteredRebuildShowsNextContract()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        FirstContractNo: Code[20];
        NextContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(0, 100, 0.5);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-PPN-006', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PPN-006', 40);
        Lib.CreateVehicle('T-PPN-007', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PPN-007', 30);
        FirstContractNo := Lib.CreateReturnedContract('T-PPN-006', 20270301D, 20270303D, 1450);
        NextContractNo := Lib.CreateReturnedContract('T-PPN-007', 20270301D, 20270302D, 1100);

        Preview.BuildPreview(FirstContractNo, PreviewLine);
        PreviewLine.SetRange(Description, 'Rental days');
        Preview.BuildPreview(NextContractNo, PreviewLine);
        PreviewLine.Reset();
        Assert.AreEqual(1, PreviewLine.Count(), 'Only the next contract''s line is left');
        Assert.AreEqual(60.00, Preview.TotalAmount(PreviewLine), '2 x 30');
    end;

    [Test]
    procedure FilteredTotalSumsVisibleLines()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(50, 100, 0.5);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-PPN-008', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PPN-008', 50);
        ContractNo := Lib.CreateReturnedContract('T-PPN-008', 20270305D, 20270307D, 1450);

        Preview.BuildPreview(ContractNo, PreviewLine);
        PreviewLine.SetRange(Description, 'Excess km');
        Assert.AreEqual(75.00, Preview.TotalAmount(PreviewLine), 'Only the excess km line');
    end;

    [Test]
    procedure PreviewLinesCarryContractNo()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(50, 100, 0.5);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-PPN-009', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PPN-009', 50);
        ContractNo := Lib.CreateReturnedContract('T-PPN-009', 20270305D, 20270307D, 1450);

        Preview.BuildPreview(ContractNo, PreviewLine);
        PreviewLine.FindSet();
        repeat
            Assert.AreEqual(ContractNo, PreviewLine."Contract No.", 'Each line carries the contract number');
        until PreviewLine.Next() = 0;
    end;
}
