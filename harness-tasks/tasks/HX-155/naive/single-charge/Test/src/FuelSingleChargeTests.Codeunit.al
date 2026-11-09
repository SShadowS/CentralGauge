codeunit 80627 "CGR Fuel Single Charge Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        SingleNotReturnedErr: Label 'Rental contract %1 must be returned before fuel is charged.', Comment = '%1 = contract number';

    [Test]
    procedure SingleHalfTankCharged()
    var
        Entry: Record "CGR Fuel Charge Entry";
        Spy: Codeunit "CGR Fuel Single Charge Spy";
        FuelCharge: Codeunit "CGR Fuel Charge";
        ContractNo: Code[20];
    begin
        ContractNo := SingleReturnedContract('HX155-NC1', 60, 2);
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
    procedure SingleQuarterCharged()
    var
        Entry: Record "CGR Fuel Charge Entry";
        Spy: Codeunit "CGR Fuel Single Charge Spy";
        FuelCharge: Codeunit "CGR Fuel Charge";
        ContractNo: Code[20];
    begin
        ContractNo := SingleReturnedContract('HX155-NC2', 47, 1.87);
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
    procedure SingleNoLevelNoCharge()
    var
        Entry: Record "CGR Fuel Charge Entry";
        FuelCharge: Codeunit "CGR Fuel Charge";
        ContractNo: Code[20];
    begin
        ContractNo := SingleReturnedContract('HX155-NC3', 60, 2);
        FuelCharge.ChargeFuel(ContractNo);
        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Entry.Count(), 'No entry without a level');
    end;

    [Test]
    procedure SingleNotReturnedRefused()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        FuelCharge: Codeunit "CGR Fuel Charge";
        ContractNo: Code[20];
    begin
        SinglePrepare(2);
        SingleVehicle('HX155-NC4', 60);
        ContractNo := RentalMgt.CreateContract('HX155-NC4', 'HX155 Customer', 20250303D, 20250308D);
        RentalMgt.CheckOut(ContractNo);
        Commit();
        asserterror FuelCharge.ChargeFuel(ContractNo);
        Assert.ExpectedError(StrSubstNo(SingleNotReturnedErr, ContractNo));
    end;

    [Test]
    procedure SingleFullTankNoEntry()
    var
        Entry: Record "CGR Fuel Charge Entry";
        Spy: Codeunit "CGR Fuel Single Charge Spy";
        FuelCharge: Codeunit "CGR Fuel Charge";
        ContractNo: Code[20];
    begin
        ContractNo := SingleReturnedContract('HX155-NC5', 60, 2);
        Spy.SetLevel(100);
        BindSubscription(Spy);
        FuelCharge.ChargeFuel(ContractNo);
        UnbindSubscription(Spy);
        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Entry.Count(), 'No entry at 100 %');
    end;

    local procedure SinglePrepare(PricePerLitre: Decimal)
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

    local procedure SingleVehicle(VehicleNo: Code[20]; TankLitres: Decimal)
    var
        FuelVehicle: Record "CGR Vehicle";
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        FuelVehicle.Get(VehicleNo);
        FuelVehicle."Tank Litres" := TankLitres;
        FuelVehicle.Modify();
    end;

    local procedure SingleReturnedContract(VehicleNo: Code[20]; TankLitres: Decimal; PricePerLitre: Decimal): Code[20]
    begin
        SinglePrepare(PricePerLitre);
        SingleVehicle(VehicleNo, TankLitres);
        exit(Lib.CreateReturnedContract(VehicleNo, 20250303D, 20250308D, 1200));
    end;
}
