codeunit 88360 "HX160 Damage Counter Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        DamageMgt: Codeunit "CGR Damage Mgt";
        Archive: Codeunit "HX160 Archive Deleter";

    [Test]
    procedure RepairingLastDamageUnblocks()
    var
        EntryNo: Integer;
    begin
        InitHX160('HX160-1A', 20240301D);
        EntryNo := DamageMgt.RegisterDamage('HX160-1A', 'Dent');

        DamageMgt.RepairDamage(EntryNo);

        AssertHX160Vehicle('HX160-1A', 0, false, 'After the only damage is repaired');
    end;

    [Test]
    procedure RepairOneOfTwoStaysBlocked()
    var
        FirstEntryNo: Integer;
        SecondEntryNo: Integer;
    begin
        InitHX160('HX160-2B', 20240301D);
        FirstEntryNo := DamageMgt.RegisterDamage('HX160-2B', 'Dent');
        SecondEntryNo := DamageMgt.RegisterDamage('HX160-2B', 'Scratch');
        DamageMgt.RegisterDamage('HX160-2B', 'Mirror');
        DamageMgt.RepairDamage(FirstEntryNo);

        DamageMgt.RepairDamage(SecondEntryNo);

        AssertHX160Vehicle('HX160-2B', 1, true, 'Two of three damages repaired');
    end;

    [Test]
    procedure ReturnWithDamageBlocksAndCounts()
    var
        ContractNo: Code[20];
        RentalMgt: Codeunit "CGR Rental Mgt";
        Vehicle: Record "CGR Vehicle";
    begin
        InitHX160('HX160-3C', 20240301D);
        ContractNo := CheckedOutHX160Contract('HX160-3C');

        RentalMgt.Return(ContractNo, 1400, 'Bumper');

        Vehicle.Get('HX160-3C');
        Assert.AreEqual(1400, Vehicle.Mileage, 'A return records the mileage');
        Assert.IsFalse(Vehicle."Checked Out", 'A return frees the vehicle');
        AssertHX160Vehicle('HX160-3C', 1, true, 'A return with new damage');
    end;

    [Test]
    procedure ReturnWithoutDamageKeepsCounters()
    var
        ContractNo: Code[20];
        RentalMgt: Codeunit "CGR Rental Mgt";
        Vehicle: Record "CGR Vehicle";
    begin
        InitHX160('HX160-4D', 20240301D);
        ContractNo := CheckedOutHX160Contract('HX160-4D');

        RentalMgt.Return(ContractNo, 1250, '');

        Vehicle.Get('HX160-4D');
        Assert.AreEqual(1250, Vehicle.Mileage, 'A return records the mileage');
        Assert.IsFalse(Vehicle."Checked Out", 'A return frees the vehicle');
        AssertHX160Vehicle('HX160-4D', 0, false, 'A return without damage');
    end;

    [Test]
    procedure ArchiveAppDeleteWithoutTriggers()
    var
        FirstEntryNo: Integer;
        SecondEntryNo: Integer;
    begin
        InitHX160('HX160-5E', 20240301D);
        FirstEntryNo := DamageMgt.RegisterDamage('HX160-5E', 'Dent');
        SecondEntryNo := DamageMgt.RegisterDamage('HX160-5E', 'Scratch');

        Archive.DeleteHX160Entry(FirstEntryNo, false);
        AssertHX160Vehicle('HX160-5E', 1, true, 'One of two open entries deleted without triggers');

        Archive.DeleteHX160Entry(SecondEntryNo, false);
        AssertHX160Vehicle('HX160-5E', 0, false, 'The last open entry deleted without triggers');
    end;

    [Test]
    procedure ArchiveAppBulkDelete()
    var
        FirstEntryNo: Integer;
        SecondEntryNo: Integer;
        RepairedEntryNo: Integer;
    begin
        InitHX160('HX160-6F', 20240301D);
        FirstEntryNo := DamageMgt.RegisterDamage('HX160-6F', 'Dent');
        SecondEntryNo := DamageMgt.RegisterDamage('HX160-6F', 'Scratch');
        DamageMgt.RegisterDamage('HX160-6F', 'Mirror');
        RepairedEntryNo := DamageMgt.RegisterDamage('HX160-6F', 'Fender');
        DamageMgt.RepairDamage(RepairedEntryNo);

        Archive.DeleteHX160Entries(StrSubstNo('%1|%2|%3', FirstEntryNo, SecondEntryNo, RepairedEntryNo), false);

        AssertHX160Vehicle('HX160-6F', 1, true, 'Two open and one repaired entry deleted in bulk without triggers');
    end;

    [Test]
    procedure ArchiveAppDeleteWithTriggers()
    var
        FirstEntryNo: Integer;
        SecondEntryNo: Integer;
        ThirdEntryNo: Integer;
    begin
        InitHX160('HX160-7G', 20240301D);
        FirstEntryNo := DamageMgt.RegisterDamage('HX160-7G', 'Dent');
        SecondEntryNo := DamageMgt.RegisterDamage('HX160-7G', 'Scratch');
        ThirdEntryNo := DamageMgt.RegisterDamage('HX160-7G', 'Mirror');

        Archive.DeleteHX160Entry(FirstEntryNo, true);
        AssertHX160Vehicle('HX160-7G', 2, true, 'One open entry deleted with triggers');

        Archive.DeleteHX160Entries(StrSubstNo('%1|%2', SecondEntryNo, ThirdEntryNo), true);
        AssertHX160Vehicle('HX160-7G', 0, false, 'The remaining open entries deleted in bulk with triggers');
    end;

    [Test]
    procedure ArchiveDeleteOfRepairedKeepsCounter()
    var
        RepairedEntryNo: Integer;
    begin
        InitHX160('HX160-8H', 20240301D);
        DamageMgt.RegisterDamage('HX160-8H', 'Dent');
        DamageMgt.RegisterDamage('HX160-8H', 'Scratch');
        RepairedEntryNo := DamageMgt.RegisterDamage('HX160-8H', 'Mirror');
        DamageMgt.RepairDamage(RepairedEntryNo);

        Archive.DeleteHX160Entry(RepairedEntryNo, false);

        AssertHX160Vehicle('HX160-8H', 2, true, 'A repaired entry deleted without triggers');
    end;

    [Test]
    procedure ArchiveDeleteLeavesOtherVehicle()
    begin
        InitHX160('HX160-9J', 20240301D);
        InitHX160('HX160-9K', 20240301D);
        DamageMgt.RegisterDamage('HX160-9J', 'Dent');
        DamageMgt.RegisterDamage('HX160-9K', 'Scratch');
        DamageMgt.RegisterDamage('HX160-9K', 'Mirror');

        Archive.DeleteHX160Vehicle('HX160-9J', false);

        AssertHX160Vehicle('HX160-9J', 0, false, 'The vehicle whose entries were deleted');
        AssertHX160Vehicle('HX160-9K', 2, true, 'The other vehicle');
    end;

    [Test]
    procedure CleanupKeepsCounterAndStampsVehicle()
    var
        Cleanup: Codeunit "CGR Damage Cleanup";
        Vehicle: Record "CGR Vehicle";
        RepairedEntryNo: Integer;
    begin
        InitHX160('HX160-AL', 20230110D);
        DamageMgt.RegisterDamage('HX160-AL', 'Old dent');
        DamageMgt.RegisterDamage('HX160-AL', 'Old scratch');
        RepairedEntryNo := DamageMgt.RegisterDamage('HX160-AL', 'Old fender');
        DamageMgt.RepairDamage(RepairedEntryNo);
        WorkDate(20240210D);
        DamageMgt.RegisterDamage('HX160-AL', 'Recent mirror');
        WorkDate(20240615D);

        Cleanup.PurgeOlderThan(20230630D);

        AssertHX160Vehicle('HX160-AL', 1, true, 'After the cleanup one recent open entry is left');
        Vehicle.Get('HX160-AL');
        Assert.AreEqual(20240615D, Vehicle."Last Damage Cleanup", 'The cleanup stamps the vehicle it purged entries for');
    end;

    [Test]
    procedure CleanupLeavesUnpurgedVehicleBlank()
    var
        Cleanup: Codeunit "CGR Damage Cleanup";
        Vehicle: Record "CGR Vehicle";
    begin
        InitHX160('HX160-BM', 20230110D);
        InitHX160('HX160-BN', 20230110D);
        DamageMgt.RegisterDamage('HX160-BM', 'Old dent');
        WorkDate(20240210D);
        DamageMgt.RegisterDamage('HX160-BN', 'Recent scratch');
        WorkDate(20240615D);

        Cleanup.PurgeOlderThan(20230630D);

        Vehicle.Get('HX160-BM');
        Assert.AreEqual(20240615D, Vehicle."Last Damage Cleanup", 'The cleanup stamps the vehicle it purged entries for');
        Vehicle.Get('HX160-BN');
        Assert.AreEqual(0D, Vehicle."Last Damage Cleanup", 'A vehicle with nothing purged gets no stamp');
        AssertHX160Vehicle('HX160-BN', 1, true, 'A vehicle with nothing purged');
    end;

    local procedure InitHX160(VehicleNo: Code[20]; NewWorkDate: Date)
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Contract: Record "CGR Rental Contract";
    begin
        WorkDate(NewWorkDate);
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle.Insert();
    end;

    local procedure CheckedOutHX160Contract(VehicleNo: Code[20]): Code[20]
    var
        Setup: Record "CGR Setup";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Setup.GetOrCreate();
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX160 Customer', 20240301D, 20240303D);
        RentalMgt.CheckOut(ContractNo);
        exit(ContractNo);
    end;

    local procedure AssertHX160Vehicle(VehicleNo: Code[20]; ExpectedOpen: Integer; ExpectedBlocked: Boolean; Context: Text)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        Assert.AreEqual(ExpectedOpen, Vehicle."Open Damages", Context + ': Open Damages');
        Assert.AreEqual(ExpectedBlocked, Vehicle.Blocked, Context + ': Blocked');
    end;
}
