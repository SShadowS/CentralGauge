codeunit 86360 "HX045 Damage Block Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure ImportedDamageBlocks()
    var
        Lines: Record "CGR Damage Entry" temporary;
        DamageEntry: Record "CGR Damage Entry";
        DamageImport: Codeunit "CGR Damage Import";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        InitHX45('HX045-1A');
        AddHX45Line(Lines, 1, 'HX045-1A', 'Cracked windscreen', 20270220D, false);

        Assert.AreEqual(1, DamageImport.ImportDamages(Lines), 'One imported line is stored');

        AssertHX45Vehicle('HX045-1A', true, 1, 'An imported damage blocks the vehicle once');
        DamageEntry.SetRange("Vehicle No.", 'HX045-1A');
        Assert.AreEqual(1, DamageEntry.Count(), 'One damage entry is stored for the vehicle');
        DamageEntry.FindFirst();
        Assert.AreEqual(20270220D, DamageEntry."Reported On", 'The workshop report date is kept');
        Assert.IsFalse(FleetMgt.IsAvailable('HX045-1A'), 'A vehicle with an imported damage is not available');
    end;

    [Test]
    procedure ImportOfTwoLinesCountsTwo()
    var
        Lines: Record "CGR Damage Entry" temporary;
        DamageImport: Codeunit "CGR Damage Import";
    begin
        InitHX45('HX045-2A');
        AddHX45Line(Lines, 1, 'HX045-2A', 'Dent left door', 20270220D, false);
        AddHX45Line(Lines, 2, 'HX045-2A', 'Scratch bumper', 20270221D, false);

        Assert.AreEqual(2, DamageImport.ImportDamages(Lines), 'Both imported lines are stored');

        AssertHX45Vehicle('HX045-2A', true, 2, 'Two imported damages count two open damages');
    end;

    [Test]
    procedure DirectInsertBlocks()
    var
        DamageEntry: Record "CGR Damage Entry";
    begin
        InitHX45('HX045-3B');
        DamageEntry.Init();
        DamageEntry."Vehicle No." := 'HX045-3B';
        DamageEntry.Description := 'Inserted by another app';
        DamageEntry."Reported On" := 20270225D;
        DamageEntry.Insert();

        AssertHX45Vehicle('HX045-3B', true, 1, 'A damage entry stored by other code blocks the vehicle once');
    end;

    [Test]
    procedure TemporaryEntryChangesNothing()
    var
        TempDamageEntry: Record "CGR Damage Entry" temporary;
        DamageEntry: Record "CGR Damage Entry";
    begin
        InitHX45('HX045-4C');
        TempDamageEntry.Init();
        TempDamageEntry."Entry No." := 1;
        TempDamageEntry."Vehicle No." := 'HX045-4C';
        TempDamageEntry.Description := 'Held in memory only';
        TempDamageEntry."Reported On" := 20270225D;
        TempDamageEntry.Insert(true);
        Assert.AreEqual(1, TempDamageEntry.Count(), 'The temporary entry is held in memory');

        AssertHX45Vehicle('HX045-4C', false, 0, 'A temporary damage entry changes no vehicle');
        DamageEntry.SetRange("Vehicle No.", 'HX045-4C');
        Assert.AreEqual(0, DamageEntry.Count(), 'A temporary damage entry stores no real damage entry');
    end;

    [Test]
    procedure RegisterDamageCountsOnce()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
    begin
        InitHX45('HX045-5D');

        DamageMgt.RegisterDamage('HX045-5D', 'Dent');

        AssertHX45Vehicle('HX045-5D', true, 1, 'A registered damage blocks the vehicle and counts once');
    end;

    [Test]
    procedure RepairedEntryDoesNotBlock()
    var
        DamageEntry: Record "CGR Damage Entry";
    begin
        InitHX45('HX045-6E');
        DamageEntry.Init();
        DamageEntry."Vehicle No." := 'HX045-6E';
        DamageEntry.Description := 'Already repaired';
        DamageEntry."Reported On" := 20270225D;
        DamageEntry.Repaired := true;
        DamageEntry.Insert();

        DamageEntry.Reset();
        DamageEntry.SetRange("Vehicle No.", 'HX045-6E');
        DamageEntry.SetRange(Repaired, true);
        Assert.AreEqual(1, DamageEntry.Count(), 'The repaired entry is stored');
        AssertHX45Vehicle('HX045-6E', false, 0, 'An entry stored as repaired neither blocks nor counts');
    end;

    [Test]
    procedure ImportedRepairedLineDoesNotBlock()
    var
        Lines: Record "CGR Damage Entry" temporary;
        DamageEntry: Record "CGR Damage Entry";
        DamageImport: Codeunit "CGR Damage Import";
    begin
        InitHX45('HX045-7F');
        AddHX45Line(Lines, 1, 'HX045-7F', 'Fixed at the workshop', 20270220D, true);

        Assert.AreEqual(1, DamageImport.ImportDamages(Lines), 'A repaired line is still stored');

        DamageEntry.SetRange("Vehicle No.", 'HX045-7F');
        Assert.AreEqual(1, DamageEntry.Count(), 'The repaired line is stored as one entry');
        DamageEntry.FindFirst();
        Assert.IsTrue(DamageEntry.Repaired, 'The workshop repaired flag is kept');
        AssertHX45Vehicle('HX045-7F', false, 0, 'An imported repaired line neither blocks nor counts');
    end;

    [Test]
    procedure DamagedReturnBlocksOnce()
    var
        Vehicle: Record "CGR Vehicle";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        InitHX45('HX045-8G');
        InsertHX45CheckedOutContract('HX045-8C', 'HX045-8G');

        RentalMgt.Return('HX045-8C', 1100, 'Scratch');

        AssertHX45Vehicle('HX045-8G', true, 1, 'A return with damage blocks the vehicle and counts once');
        Vehicle.Get('HX045-8G');
        Assert.IsFalse(Vehicle."Checked Out", 'The returned vehicle is no longer checked out');
    end;

    [Test]
    procedure ImportSkipsUnknownVehicle()
    var
        Lines: Record "CGR Damage Entry" temporary;
        DamageEntry: Record "CGR Damage Entry";
        DamageImport: Codeunit "CGR Damage Import";
    begin
        InitHX45('HX045-9H');
        DamageEntry.SetRange("Vehicle No.", 'HX045-NONE');
        DamageEntry.DeleteAll();
        AddHX45Line(Lines, 1, 'HX045-NONE', 'Unknown vehicle', 20270220D, false);
        AddHX45Line(Lines, 2, 'HX045-9H', 'Dent', 20270220D, false);
        AddHX45Line(Lines, 3, 'HX045-9H', '', 20270220D, false);

        Assert.AreEqual(1, DamageImport.ImportDamages(Lines), 'Only the described line for a known vehicle is stored');

        Assert.AreEqual(0, DamageEntry.Count(), 'No entry is stored for an unknown vehicle');
        DamageEntry.SetRange("Vehicle No.", 'HX045-9H');
        Assert.AreEqual(1, DamageEntry.Count(), 'A line without a description is not stored');
        AssertHX45Vehicle('HX045-9H', true, 1, 'The known vehicle is blocked once');
    end;

    [Test]
    procedure RepairAfterImportUnblocks()
    var
        Lines: Record "CGR Damage Entry" temporary;
        DamageEntry: Record "CGR Damage Entry";
        DamageImport: Codeunit "CGR Damage Import";
        DamageMgt: Codeunit "CGR Damage Mgt";
    begin
        InitHX45('HX045-10J');
        AddHX45Line(Lines, 1, 'HX045-10J', 'Dent', 20270220D, false);
        DamageImport.ImportDamages(Lines);
        AssertHX45Vehicle('HX045-10J', true, 1, 'Before the repair the imported damage blocks the vehicle');
        DamageEntry.SetRange("Vehicle No.", 'HX045-10J');
        DamageEntry.FindFirst();

        DamageMgt.RepairDamage(DamageEntry."Entry No.");

        AssertHX45Vehicle('HX045-10J', false, 0, 'Repairing the only imported damage unblocks the vehicle');
    end;

    local procedure InitHX45(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Contract: Record "CGR Rental Contract";
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();

        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle.Strategy := Enum::"CGR Maintenance Strategy"::Default;
        Vehicle.Insert();
    end;

    local procedure AddHX45Line(var Lines: Record "CGR Damage Entry" temporary; EntryNo: Integer; VehicleNo: Code[20]; Description: Text[100]; ReportedOn: Date; Repaired: Boolean)
    begin
        Lines.Init();
        Lines."Entry No." := EntryNo;
        Lines."Vehicle No." := VehicleNo;
        Lines.Description := Description;
        Lines."Reported On" := ReportedOn;
        Lines.Repaired := Repaired;
        Lines.Insert();
    end;

    local procedure InsertHX45CheckedOutContract(ContractNo: Code[20]; VehicleNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
    begin
        if Contract.Get(ContractNo) then
            Contract.Delete();
        Contract.Init();
        Contract."No." := ContractNo;
        Contract."Vehicle No." := VehicleNo;
        Contract."Customer Name" := 'HX045 Customer';
        Contract."Start Date" := 20270301D;
        Contract."End Date" := 20270303D;
        Contract.Status := Contract.Status::"Checked Out";
        Contract."Start Km" := 1000;
        Contract.Insert();
        Vehicle.Get(VehicleNo);
        Vehicle."Checked Out" := true;
        Vehicle.Modify();
    end;

    local procedure AssertHX45Vehicle(VehicleNo: Code[20]; ExpectedBlocked: Boolean; ExpectedOpenDamages: Integer; Context: Text)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        Assert.AreEqual(ExpectedBlocked, Vehicle.Blocked, Context + ': Blocked');
        Assert.AreEqual(ExpectedOpenDamages, Vehicle."Open Damages", Context + ': Open Damages');
    end;
}
