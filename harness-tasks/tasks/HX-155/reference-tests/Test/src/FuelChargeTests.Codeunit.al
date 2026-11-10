codeunit 80620 "CGR Fuel Charge Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        FuelNotReturnedErr: Label 'Rental contract %1 must be returned before fuel is charged.', Comment = '%1 = contract number';

    [Test]
    procedure HeadlessReturnChargesHalfTank()
    var
        Entry: Record "CGR Fuel Charge Entry";
        Spy: Codeunit "CGR Fuel Telematics Spy";
        Runner: Codeunit "CGR Fuel Charge Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        ContractNo := HX155ReturnedContract('HX155-A1', 60, 2);
        Spy.SetLevel(50);
        BindSubscription(Spy);
        Runner.SetFuelContract(ContractNo);

        Commit();
        Ok := Runner.Run();
        UnbindSubscription(Spy);

        Assert.IsTrue(Ok, 'The fuel charge finishes without a user interface: ' + GetLastErrorText());
        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Entry.Count(), 'One fuel charge entry at 50 %');
        Entry.FindFirst();
        Assert.AreEqual(30, Entry.Litres, 'Half of a 60 litre tank is missing');
        Assert.AreEqual(60, Entry.Amount, '30 litres x 2.00');
    end;

    [Test]
    procedure QuarterMissingRoundsAmount()
    var
        Entry: Record "CGR Fuel Charge Entry";
        Spy: Codeunit "CGR Fuel Telematics Spy";
        FuelCharge: Codeunit "CGR Fuel Charge";
        ContractNo: Code[20];
    begin
        ContractNo := HX155ReturnedContract('HX155-B1', 47, 1.87);
        Spy.SetLevel(75);
        BindSubscription(Spy);

        FuelCharge.ChargeFuel(ContractNo);
        UnbindSubscription(Spy);

        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Entry.Count(), 'One fuel charge entry at 75 %');
        Entry.FindFirst();
        Assert.AreEqual(11.75, Entry.Litres, '25 % of a 47 litre tank is missing');
        Assert.AreEqual(21.97, Entry.Amount, '11.75 litres x 1.87 rounded to 0.01');
    end;

    [Test]
    procedure NoTelematicsLevelChargesNothing()
    var
        Entry: Record "CGR Fuel Charge Entry";
        FuelCharge: Codeunit "CGR Fuel Charge";
        ContractNo: Code[20];
    begin
        ContractNo := HX155ReturnedContract('HX155-C1', 60, 2);

        FuelCharge.ChargeFuel(ContractNo);

        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Entry.Count(), 'Without a level from the telematics app nothing is charged');
    end;

    [Test]
    procedure ContractIsChargedOnlyOnce()
    var
        Entry: Record "CGR Fuel Charge Entry";
        Spy: Codeunit "CGR Fuel Telematics Spy";
        FuelCharge: Codeunit "CGR Fuel Charge";
        ContractNo: Code[20];
    begin
        ContractNo := HX155ReturnedContract('HX155-D1', 60, 2);
        Spy.SetLevel(50);
        BindSubscription(Spy);

        FuelCharge.ChargeFuel(ContractNo);
        FuelCharge.ChargeFuel(ContractNo);
        UnbindSubscription(Spy);

        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Entry.Count(), 'A contract is charged at most once');
    end;

    [Test]
    procedure CheckedOutContractIsRefused()
    var
        Entry: Record "CGR Fuel Charge Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Spy: Codeunit "CGR Fuel Telematics Spy";
        Runner: Codeunit "CGR Fuel Charge Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        HX155Prepare(2);
        HX155Vehicle('HX155-E1', 60);
        ContractNo := RentalMgt.CreateContract('HX155-E1', 'HX155 Customer', 20250303D, 20250308D);
        RentalMgt.CheckOut(ContractNo);
        Spy.SetLevel(50);
        BindSubscription(Spy);
        Runner.SetFuelContract(ContractNo);

        Commit();
        Ok := Runner.Run();
        UnbindSubscription(Spy);

        Assert.IsFalse(Ok, 'A checked-out contract is not charged');
        Assert.AreEqual(StrSubstNo(FuelNotReturnedErr, ContractNo), GetLastErrorText(), 'The refusal names the contract');
        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Entry.Count(), 'No fuel charge entry for a checked-out contract');
    end;

    [Test]
    procedure FullTankWritesNoEntry()
    var
        Entry: Record "CGR Fuel Charge Entry";
        Spy: Codeunit "CGR Fuel Telematics Spy";
        FuelCharge: Codeunit "CGR Fuel Charge";
        ContractNo: Code[20];
    begin
        ContractNo := HX155ReturnedContract('HX155-F1', 60, 2);
        Spy.SetLevel(100);
        BindSubscription(Spy);

        FuelCharge.ChargeFuel(ContractNo);
        UnbindSubscription(Spy);

        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Entry.Count(), 'A full tank writes no entry');
    end;

    local procedure HX155Prepare(PricePerLitre: Decimal)
    var
        Setup: Record "CGR Setup";
        Entry: Record "CGR Fuel Charge Entry";
    begin
        WorkDate(20250310D);
        Entry.DeleteAll();
        Setup.GetOrCreate();
        Setup."Fuel Price per Litre" := PricePerLitre;
        Setup.Modify();
    end;

    local procedure HX155Vehicle(VehicleNo: Code[20]; TankLitres: Decimal)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Vehicle.Get(VehicleNo);
        Vehicle."Tank Litres" := TankLitres;
        Vehicle.Modify();
    end;

    local procedure HX155ReturnedContract(VehicleNo: Code[20]; TankLitres: Decimal; PricePerLitre: Decimal): Code[20]
    begin
        HX155Prepare(PricePerLitre);
        HX155Vehicle(VehicleNo, TankLitres);
        exit(Lib.CreateReturnedContract(VehicleNo, 20250303D, 20250308D, 1200));
    end;
}
