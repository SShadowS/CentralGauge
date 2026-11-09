codeunit 80625 "CGR Fuel Half Only Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        HalfOnlyNotReturnedErr: Label 'Rental contract %1 must be returned before fuel is charged.', Comment = '%1 = contract number';

    [Test]
    procedure HalfTankChargedAtHalfPrice()
    var
        Entry: Record "CGR Fuel Charge Entry";
        Spy: Codeunit "CGR Fuel Half Only Spy";
        FuelCharge: Codeunit "CGR Fuel Charge";
        ContractNo: Code[20];
    begin
        ContractNo := HalfOnlyReturnedContract('HX155-NB1', 60, 2);
        Spy.SetLevel(50);
        BindSubscription(Spy);
        FuelCharge.ChargeFuel(ContractNo);
        UnbindSubscription(Spy);

        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Entry.Count(), 'One entry');
        Entry.FindFirst();
        Assert.AreEqual(30, Entry.Litres, 'Litres');
        Assert.AreEqual(60, Entry.Amount, 'Amount');
    end;

    [Test]
    procedure HalfOnlyNoLevelNoCharge()
    var
        Entry: Record "CGR Fuel Charge Entry";
        FuelCharge: Codeunit "CGR Fuel Charge";
        ContractNo: Code[20];
    begin
        ContractNo := HalfOnlyReturnedContract('HX155-NB2', 60, 2);
        FuelCharge.ChargeFuel(ContractNo);
        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Entry.Count(), 'No entry without a level');
    end;

    [Test]
    procedure HalfOnlyChargedOnce()
    var
        Entry: Record "CGR Fuel Charge Entry";
        Spy: Codeunit "CGR Fuel Half Only Spy";
        FuelCharge: Codeunit "CGR Fuel Charge";
        ContractNo: Code[20];
    begin
        ContractNo := HalfOnlyReturnedContract('HX155-NB3', 60, 2);
        Spy.SetLevel(50);
        BindSubscription(Spy);
        FuelCharge.ChargeFuel(ContractNo);
        FuelCharge.ChargeFuel(ContractNo);
        UnbindSubscription(Spy);
        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Entry.Count(), 'One entry');
    end;

    [Test]
    procedure HalfOnlyNotReturnedRefused()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        FuelCharge: Codeunit "CGR Fuel Charge";
        ContractNo: Code[20];
    begin
        HalfOnlyPrepare(2);
        HalfOnlyVehicle('HX155-NB4', 60);
        ContractNo := RentalMgt.CreateContract('HX155-NB4', 'HX155 Customer', 20250303D, 20250308D);
        RentalMgt.CheckOut(ContractNo);
        Commit();
        asserterror FuelCharge.ChargeFuel(ContractNo);
        Assert.ExpectedError(StrSubstNo(HalfOnlyNotReturnedErr, ContractNo));
    end;

    [Test]
    procedure HalfOnlyFullTankNoEntry()
    var
        Entry: Record "CGR Fuel Charge Entry";
        Spy: Codeunit "CGR Fuel Half Only Spy";
        FuelCharge: Codeunit "CGR Fuel Charge";
        ContractNo: Code[20];
    begin
        ContractNo := HalfOnlyReturnedContract('HX155-NB5', 60, 2);
        Spy.SetLevel(100);
        BindSubscription(Spy);
        FuelCharge.ChargeFuel(ContractNo);
        UnbindSubscription(Spy);
        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Entry.Count(), 'No entry at 100 %');
    end;

    local procedure HalfOnlyPrepare(PricePerLitre: Decimal)
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

    local procedure HalfOnlyVehicle(VehicleNo: Code[20]; TankLitres: Decimal)
    var
        FuelVehicle: Record "CGR Vehicle";
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        FuelVehicle.Get(VehicleNo);
        FuelVehicle."Tank Litres" := TankLitres;
        FuelVehicle.Modify();
    end;

    local procedure HalfOnlyReturnedContract(VehicleNo: Code[20]; TankLitres: Decimal; PricePerLitre: Decimal): Code[20]
    begin
        HalfOnlyPrepare(PricePerLitre);
        HalfOnlyVehicle(VehicleNo, TankLitres);
        exit(Lib.CreateReturnedContract(VehicleNo, 20250303D, 20250308D, 1200));
    end;
}
