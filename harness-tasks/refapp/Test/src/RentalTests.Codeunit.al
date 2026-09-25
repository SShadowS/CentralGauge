codeunit 80010 "CGR Rental Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure CheckOutMarksVehicleCheckedOut()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.CreateVehicle('T-RENT-001', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('T-RENT-001');
        RentalMgt.CheckOut(ContractNo);
        Vehicle.Get('T-RENT-001');
        Assert.IsTrue(Vehicle."Checked Out", 'Fleet subscriber must mark the vehicle checked out');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'Contract status after checkout');
        Assert.AreEqual(1000, Contract."Start Km", 'Start km is the vehicle mileage at checkout');
    end;

    [Test]
    procedure CheckOutTwiceFails()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        FirstContractNo: Code[20];
        SecondContractNo: Code[20];
    begin
        Lib.CreateVehicle('T-RENT-002', 1000, Enum::"CGR Maintenance Strategy"::Default);
        FirstContractNo := Lib.CreateContract('T-RENT-002');
        SecondContractNo := Lib.CreateContract('T-RENT-002');
        RentalMgt.CheckOut(FirstContractNo);
        asserterror RentalMgt.CheckOut(SecondContractNo);
        Assert.ExpectedError('Vehicle T-RENT-002 is not available.');
    end;

    [Test]
    procedure ReturnWithoutDamageReleasesVehicle()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.CreateVehicle('T-RENT-003', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('T-RENT-003');
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1300, '');
        Vehicle.Get('T-RENT-003');
        Assert.IsFalse(Vehicle."Checked Out", 'Returned vehicle is no longer checked out');
        Assert.AreEqual(1300, Vehicle.Mileage, 'Mileage is the return km');
        Assert.IsFalse(Vehicle.Blocked, 'Return without damage does not block');
        Assert.AreEqual(0, Vehicle."Open Damages", 'Return without damage leaves no open damage');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Contract status after return');
        Assert.AreEqual(1300, Contract."Return Km", 'Contract return km');
    end;

    [Test]
    procedure ReturnBelowStartKmFails()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.CreateVehicle('T-RENT-004', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('T-RENT-004');
        RentalMgt.CheckOut(ContractNo);
        asserterror RentalMgt.Return(ContractNo, 999, '');
        Assert.ExpectedError('Return km 999 is below the start km 1000.');
    end;

    [Test]
    procedure SwapMovesContractToFreeVehicle()
    var
        OldVehicle: Record "CGR Vehicle";
        NewVehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.CreateVehicle('T-RENT-005', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('T-RENT-006', 2500, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('T-RENT-005');
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.SwapVehicle(ContractNo, 'T-RENT-006');
        Contract.Get(ContractNo);
        Assert.AreEqual('T-RENT-006', Contract."Vehicle No.", 'Contract moves to the new vehicle');
        Assert.AreEqual(2500, Contract."Start Km", 'Start km is the new vehicle mileage');
        OldVehicle.Get('T-RENT-005');
        Assert.IsFalse(OldVehicle."Checked Out", 'The old vehicle is released');
        NewVehicle.Get('T-RENT-006');
        Assert.IsTrue(NewVehicle."Checked Out", 'The new vehicle is checked out');
    end;

    [Test]
    procedure PostCreatesLedgerEntry()
    var
        Entry: Record "CGR Rental Ledger Entry";
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.SetPricing(0, 1000, 0);
        Lib.CreateVehicle('T-RENT-008', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-RENT-008', 50);
        ContractNo := Lib.CreateContract('T-RENT-008');
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1200, '');
        RentalMgt.Post(ContractNo);
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'Posting sets the contract status');
        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Entry.Count(), 'Posting creates one ledger entry');
        Entry.FindFirst();
        Assert.AreEqual('T-RENT-008', Entry."Vehicle No.", 'Ledger entry vehicle');
        Assert.AreEqual(20270303D, Entry."Posting Date", 'Ledger entry is posted on the end date');
        Assert.AreEqual(150.00, Entry.Amount, '3 days x 50');
        Assert.AreEqual(200, Entry."Km Driven", 'Ledger entry km driven');
    end;

    [Test]
    procedure DailyPriceWithWeekendSurcharge()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Pricing: Codeunit "CGR Rental Pricing";
        ContractNo: Code[20];
    begin
        Lib.SetPricing(50, 1000, 0);
        Lib.CreateVehicle('T-RENT-009', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-RENT-009', 50);
        ContractNo := RentalMgt.CreateContract('T-RENT-009', 'Test Customer', 20270305D, 20270307D);
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1000, '');
        Contract.Get(ContractNo);
        Assert.AreEqual(200.00, Pricing.CalcAmount(Contract), 'Fri-Sun: 3 x 50 plus 50 percent on Saturday and Sunday');
    end;

    [Test]
    procedure ExcessKmCharged()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Pricing: Codeunit "CGR Rental Pricing";
        ContractNo: Code[20];
    begin
        Lib.SetPricing(0, 100, 0.5);
        Lib.CreateVehicle('T-RENT-010', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-RENT-010', 50);
        ContractNo := Lib.CreateContract('T-RENT-010');
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1450, '');
        Contract.Get(ContractNo);
        Assert.AreEqual(225.00, Pricing.CalcAmount(Contract), '3 x 50 plus 150 km over the 300 km allowance at 0.50');
    end;

    [Test]
    procedure SuspendRentalsBlocksCheckout()
    var
        Setup: Record "CGR Setup";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.CreateVehicle('T-RENT-007', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('T-RENT-007');
        Setup.GetOrCreate();
        Setup."Suspend Rentals" := true;
        Setup.Modify();
        asserterror RentalMgt.CheckOut(ContractNo);
        Assert.ExpectedError('Vehicle T-RENT-007 is not available.');
    end;
}
