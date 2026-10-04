codeunit 80081 "CGR Preview Pricing Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure FilteredPreviewRebuildsUnfiltered()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        FirstContractNo: Code[20];
        NextContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(0, 100, 0.5);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-PPT-001', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PPT-001', 40);
        Lib.CreateVehicle('T-PPT-002', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PPT-002', 30);
        FirstContractNo := Lib.CreateReturnedContract('T-PPT-001', 20270301D, 20270303D, 1450);
        NextContractNo := Lib.CreateReturnedContract('T-PPT-002', 20270301D, 20270302D, 1100);

        Preview.BuildPreview(FirstContractNo, PreviewLine);
        Assert.AreEqual(2, PreviewLine.Count(), 'Rental days and excess km for the first contract');
        PreviewLine.SetRange(Description, 'Rental days');
        Preview.BuildPreview(NextContractNo, PreviewLine);

        Assert.AreEqual('', PreviewLine.GetFilters(), 'The rebuilt preview has no filters');
        PreviewLine.Reset();
        Assert.AreEqual(1, PreviewLine.Count(), 'Only the next contract''s rental days line is left');
        PreviewLine.FindFirst();
        Assert.AreEqual(NextContractNo, PreviewLine."Contract No.", 'The line belongs to the next contract');
        Assert.AreEqual(60.00, PreviewLine.Amount, '2 x 30');
    end;

    [Test]
    procedure TotalFollowsPreviewFilter()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(50, 100, 0.5);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-PPT-003', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PPT-003', 50);
        ContractNo := Lib.CreateReturnedContract('T-PPT-003', 20270305D, 20270307D, 1450);

        Preview.BuildPreview(ContractNo, PreviewLine);
        PreviewLine.SetRange(Description, 'Excess km');
        Assert.AreEqual(75.00, Preview.TotalAmount(PreviewLine), 'Only the excess km line: 150 x 0.50');
        PreviewLine.SetFilter(Description, '%1|%2', 'Rental days', 'Weekend surcharge');
        Assert.AreEqual(200.00, Preview.TotalAmount(PreviewLine), 'Rental days 150 plus weekend surcharge 50');
        PreviewLine.Reset();
        Assert.AreEqual(275.00, Preview.TotalAmount(PreviewLine), 'All three lines');
    end;

    [Test]
    procedure EveryLineCarriesContractNo()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(50, 100, 0.5);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-PPT-004', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PPT-004', 50);
        ContractNo := Lib.CreateReturnedContract('T-PPT-004', 20270305D, 20270307D, 1450);

        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(3, PreviewLine.Count(), 'Rental days, weekend surcharge and excess km');
        PreviewLine.FindSet();
        repeat
            Assert.AreEqual(ContractNo, PreviewLine."Contract No.", StrSubstNo('Line %1 carries the contract number', PreviewLine.Description));
        until PreviewLine.Next() = 0;
    end;

    [Test]
    procedure ExcessKmOnlyAboveAllowance()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        AtAllowanceNo: Code[20];
        AboveAllowanceNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(50, 100, 0.5);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-PPT-005', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PPT-005', 40);
        Lib.CreateVehicle('T-PPT-006', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PPT-006', 40);
        AtAllowanceNo := Lib.CreateReturnedContract('T-PPT-005', 20270301D, 20270303D, 1300);
        AboveAllowanceNo := Lib.CreateReturnedContract('T-PPT-006', 20270301D, 20270303D, 1301);

        Preview.BuildPreview(AtAllowanceNo, PreviewLine);
        Assert.AreEqual(1, PreviewLine.Count(), '300 km on a 3 x 100 km allowance: rental days only, no surcharge on Mon-Wed');
        PreviewLine.FindFirst();
        Assert.AreEqual('Rental days', PreviewLine.Description, 'The only line');

        Preview.BuildPreview(AboveAllowanceNo, PreviewLine);
        Assert.AreEqual(2, PreviewLine.Count(), '301 km: rental days and excess km');
        PreviewLine.SetRange(Description, 'Excess km');
        PreviewLine.FindFirst();
        Assert.AreEqual(1.0, PreviewLine.Quantity, 'One km above the allowance');
        Assert.AreEqual(0.50, PreviewLine.Amount, '1 x 0.50');
    end;

    [Test]
    procedure PackageAllowanceUsesRentalDays()
    var
        Contract: Record "CGR Rental Contract";
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        WithinAllowanceNo: Code[20];
        AboveAllowanceNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(50, 100, 0.5);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-PPT-007', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PPT-007', 40);
        Lib.CreateVehicle('T-PPT-008', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PPT-008', 40);
        WithinAllowanceNo := Lib.CreateReturnedContract('T-PPT-007', 20270305D, 20270307D, 1300);
        AboveAllowanceNo := Lib.CreateReturnedContract('T-PPT-008', 20270305D, 20270307D, 1350);
        Contract.Get(WithinAllowanceNo);
        Contract."Pricing Method" := Contract."Pricing Method"::"Weekend Package";
        Contract.Modify();
        Contract.Get(AboveAllowanceNo);
        Contract."Pricing Method" := Contract."Pricing Method"::"Weekend Package";
        Contract.Modify();

        Preview.BuildPreview(WithinAllowanceNo, PreviewLine);
        Assert.AreEqual(1, PreviewLine.Count(), '300 km on a 3-day package with 100 km per day: package line only');
        PreviewLine.FindFirst();
        Assert.AreEqual('Weekend package', PreviewLine.Description, 'The only line');
        Assert.AreEqual(1.0, PreviewLine.Quantity, 'One package');
        Assert.AreEqual(80.00, PreviewLine.Amount, 'Two daily rates');

        Preview.BuildPreview(AboveAllowanceNo, PreviewLine);
        Assert.AreEqual(2, PreviewLine.Count(), '350 km: package and excess km');
        PreviewLine.SetRange(Description, 'Excess km');
        PreviewLine.FindFirst();
        Assert.AreEqual(50.0, PreviewLine.Quantity, '350 km against 3 x 100 km');
        Assert.AreEqual(25.00, PreviewLine.Amount, '50 x 0.50');
    end;

    [Test]
    procedure SetupChangeWaitsForRefresh()
    var
        Setup: Record "CGR Setup";
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        SessionContext: Codeunit "CGR Session Context";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(0, 100, 0.5);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-PPT-009', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PPT-009', 40);
        ContractNo := Lib.CreateReturnedContract('T-PPT-009', 20270301D, 20270303D, 1450);

        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(195.00, Preview.TotalAmount(PreviewLine), '3 x 40 plus 150 km at 0.50');

        Setup.Get();
        Setup."Excess Km Rate" := 1;
        Setup.Modify();
        Preview.BuildPreview(ContractNo, PreviewLine);
        PreviewLine.SetRange(Description, 'Excess km');
        PreviewLine.FindFirst();
        Assert.AreEqual(0.5, PreviewLine."Unit Price", 'The session still prices with the loaded Setup');
        Assert.AreEqual(75.00, PreviewLine.Amount, '150 km at the loaded 0.50');

        SessionContext.RefreshSetup();
        Preview.BuildPreview(ContractNo, PreviewLine);
        PreviewLine.SetRange(Description, 'Excess km');
        PreviewLine.FindFirst();
        Assert.AreEqual(1.0, PreviewLine."Unit Price", 'The refreshed Setup reaches the price');
        Assert.AreEqual(150.00, PreviewLine.Amount, '150 km at 1.00');
        PreviewLine.Reset();
        Assert.AreEqual(270.00, Preview.TotalAmount(PreviewLine), '3 x 40 plus 150 km at 1.00');
    end;

    [Test]
    procedure WeekendSurchargeNeedsSetupPercent()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(0, 1000, 0);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-PPT-010', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-PPT-010', 50);
        ContractNo := Lib.CreateReturnedContract('T-PPT-010', 20270305D, 20270307D, 1100);

        Preview.BuildPreview(ContractNo, PreviewLine);
        Assert.AreEqual(1, PreviewLine.Count(), 'No surcharge line when Weekend Surcharge % is 0');
        PreviewLine.FindFirst();
        Assert.AreEqual('Rental days', PreviewLine.Description, 'The only line');
        Assert.AreEqual(150.00, PreviewLine.Amount, '3 x 50');
    end;
}
