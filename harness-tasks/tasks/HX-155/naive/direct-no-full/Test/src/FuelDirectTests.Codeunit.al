codeunit 80623 "CGR Fuel Direct Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        DirectNotReturnedErr: Label 'Rental contract %1 must be returned before fuel is charged.', Comment = '%1 = contract number';

    [Test]
    procedure HalfTankIsCharged()
    var
        Entry: Record "CGR Fuel Charge Entry";
        Spy: Codeunit "CGR Fuel Direct Spy";
        FuelCharge: Codeunit "CGR Fuel Charge";
        ContractNo: Code[20];
    begin
        ContractNo := DirectReturnedContract('HX155-NA1', 60, 2);
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
    procedure QuarterIsCharged()
    var
        Entry: Record "CGR Fuel Charge Entry";
        Spy: Codeunit "CGR Fuel Direct Spy";
        FuelCharge: Codeunit "CGR Fuel Charge";
        ContractNo: Code[20];
    begin
        ContractNo := DirectReturnedContract('HX155-NA2', 47, 1.87);
        Spy.SetLevel(75);
        BindSubscription(Spy);
        FuelCharge.ChargeFuel(ContractNo);
        UnbindSubscription(Spy);

        Entry.SetRange("Contract No.", ContractNo);
        Entry.FindFirst();
        Assert.AreEqual(11.75, Entry.Litres, 'Litres');
        Assert.AreEqual(21.97, Entry.Amount, 'Amount');
    end;

    [Test]
    procedure NoLevelNoCharge()
    var
        Entry: Record "CGR Fuel Charge Entry";
        FuelCharge: Codeunit "CGR Fuel Charge";
        ContractNo: Code[20];
    begin
        ContractNo := DirectReturnedContract('HX155-NA3', 60, 2);
        FuelCharge.ChargeFuel(ContractNo);
        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Entry.Count(), 'No entry without a level');
    end;

    [Test]
    procedure ChargedOnce()
    var
        Entry: Record "CGR Fuel Charge Entry";
        Spy: Codeunit "CGR Fuel Direct Spy";
        FuelCharge: Codeunit "CGR Fuel Charge";
        ContractNo: Code[20];
    begin
        ContractNo := DirectReturnedContract('HX155-NA4', 60, 2);
        Spy.SetLevel(50);
        BindSubscription(Spy);
        FuelCharge.ChargeFuel(ContractNo);
        FuelCharge.ChargeFuel(ContractNo);
        UnbindSubscription(Spy);
        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Entry.Count(), 'One entry');
    end;

    [Test]
    procedure NotReturnedIsRefused()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        FuelCharge: Codeunit "CGR Fuel Charge";
        ContractNo: Code[20];
    begin
        DirectFuelPrepare(2);
        DirectFuelVehicle('HX155-NA5', 60);
        ContractNo := RentalMgt.CreateContract('HX155-NA5', 'HX155 Customer', 20250303D, 20250308D);
        RentalMgt.CheckOut(ContractNo);
        Commit();
        asserterror FuelCharge.ChargeFuel(ContractNo);
        Assert.ExpectedError(StrSubstNo(DirectNotReturnedErr, ContractNo));
    end;

    local procedure DirectFuelPrepare(PricePerLitre: Decimal)
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

    local procedure DirectFuelVehicle(VehicleNo: Code[20]; TankLitres: Decimal)
    var
        FuelVehicle: Record "CGR Vehicle";
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        FuelVehicle.Get(VehicleNo);
        FuelVehicle."Tank Litres" := TankLitres;
        FuelVehicle.Modify();
    end;

    local procedure DirectReturnedContract(VehicleNo: Code[20]; TankLitres: Decimal; PricePerLitre: Decimal): Code[20]
    begin
        DirectFuelPrepare(PricePerLitre);
        DirectFuelVehicle(VehicleNo, TankLitres);
        exit(Lib.CreateReturnedContract(VehicleNo, 20250303D, 20250308D, 1200));
    end;
}
