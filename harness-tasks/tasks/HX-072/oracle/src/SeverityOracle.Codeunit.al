codeunit 86900 "HX072 Severity Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure MajorBlocks()
    var
        DamageEntry: Record "CGR Damage Entry";
        DamageMgt: Codeunit "CGR Damage Mgt";
        EntryNo: Integer;
    begin
        InitHX072('HX072-R1');

        EntryNo := DamageMgt.RegisterDamageWithSeverity('HX072-R1', 'Bent axle', Enum::"CGR Damage Severity"::Major);

        DamageEntry.Get(EntryNo);
        Assert.AreEqual(Enum::"CGR Damage Severity"::Major, DamageEntry.Severity, 'The entry keeps its severity');
        AssertHX072Vehicle('HX072-R1', true, 1, 'A Major damage');
    end;

    [Test]
    procedure MinorDoesNotBlock()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
    begin
        InitHX072('HX072-R2');

        DamageMgt.RegisterDamageWithSeverity('HX072-R2', 'Chipped paint', Enum::"CGR Damage Severity"::Minor);

        AssertHX072Vehicle('HX072-R2', false, 1, 'A Minor damage');
    end;

    [Test]
    procedure PartnerNonBlocking()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
    begin
        InitHX072('HX072-R3');

        DamageMgt.RegisterDamageWithSeverity('HX072-R3', 'Scuffed seat', Enum::"CGR Damage Severity"::"HX072 Cosmetic");

        AssertHX072Vehicle('HX072-R3', false, 1, 'A partner severity that does not block');
    end;

    [Test]
    procedure PartnerBlocking()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
    begin
        InitHX072('HX072-R4');

        DamageMgt.RegisterDamageWithSeverity('HX072-R4', 'Cracked frame', Enum::"CGR Damage Severity"::"HX072 Structural");

        AssertHX072Vehicle('HX072-R4', true, 1, 'A partner severity that blocks');
    end;

    [Test]
    procedure RepairLeavesNonBlocking()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
        MajorEntryNo: Integer;
    begin
        InitHX072('HX072-R5');
        MajorEntryNo := DamageMgt.RegisterDamageWithSeverity('HX072-R5', 'Bent axle', Enum::"CGR Damage Severity"::Major);
        DamageMgt.RegisterDamageWithSeverity('HX072-R5', 'Scuffed seat', Enum::"CGR Damage Severity"::"HX072 Cosmetic");
        AssertHX072Vehicle('HX072-R5', true, 2, 'Before the repair (Major and Cosmetic open)');

        DamageMgt.RepairDamage(MajorEntryNo);

        AssertHX072Vehicle('HX072-R5', false, 1, 'After repairing the Major damage, only a non-blocking partner damage is open');
    end;

    [Test]
    procedure RepairKeepsPartnerBlocking()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
        MajorEntryNo: Integer;
    begin
        InitHX072('HX072-R6');
        MajorEntryNo := DamageMgt.RegisterDamageWithSeverity('HX072-R6', 'Bent axle', Enum::"CGR Damage Severity"::Major);
        DamageMgt.RegisterDamageWithSeverity('HX072-R6', 'Cracked frame', Enum::"CGR Damage Severity"::"HX072 Structural");
        AssertHX072Vehicle('HX072-R6', true, 2, 'Before the repair (Major and Structural open)');

        DamageMgt.RepairDamage(MajorEntryNo);

        AssertHX072Vehicle('HX072-R6', true, 1, 'After repairing the Major damage, a blocking partner damage is still open');
    end;

    [Test]
    procedure RepairLastUnblocks()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
        MinorEntryNo: Integer;
        MajorEntryNo: Integer;
    begin
        InitHX072('HX072-R7');
        MinorEntryNo := DamageMgt.RegisterDamageWithSeverity('HX072-R7', 'Chipped paint', Enum::"CGR Damage Severity"::Minor);
        MajorEntryNo := DamageMgt.RegisterDamageWithSeverity('HX072-R7', 'Bent axle', Enum::"CGR Damage Severity"::Major);
        AssertHX072Vehicle('HX072-R7', true, 2, 'Before the repairs (Minor and Major open)');

        DamageMgt.RepairDamage(MinorEntryNo);
        AssertHX072Vehicle('HX072-R7', true, 1, 'After repairing the Minor damage, the Major damage is still open');

        DamageMgt.RepairDamage(MajorEntryNo);
        AssertHX072Vehicle('HX072-R7', false, 0, 'After repairing the last damage');
    end;

    [Test]
    procedure IsBlockingSeverityDirect()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
    begin
        InitHX072('HX072-R8');

        Assert.IsFalse(DamageMgt.IsBlockingSeverity(Enum::"CGR Damage Severity"::Minor), 'Minor does not block');
        Assert.IsTrue(DamageMgt.IsBlockingSeverity(Enum::"CGR Damage Severity"::Major), 'Major blocks');
        Assert.IsFalse(DamageMgt.IsBlockingSeverity(Enum::"CGR Damage Severity"::"HX072 Cosmetic"), 'A partner severity whose rule says it does not block');
        Assert.IsTrue(DamageMgt.IsBlockingSeverity(Enum::"CGR Damage Severity"::"HX072 Structural"), 'A partner severity whose rule says it blocks');
    end;

    [Test]
    procedure RegisterDamageIsMajor()
    var
        DamageEntry: Record "CGR Damage Entry";
        DamageMgt: Codeunit "CGR Damage Mgt";
        EntryNo: Integer;
    begin
        InitHX072('HX072-R9');

        EntryNo := DamageMgt.RegisterDamage('HX072-R9', 'Dent');

        DamageEntry.Get(EntryNo);
        Assert.AreEqual(Enum::"CGR Damage Severity"::Major, DamageEntry.Severity, 'RegisterDamage registers a Major damage');
        AssertHX072Vehicle('HX072-R9', true, 1, 'RegisterDamage');
    end;

    [Test]
    procedure DamagedReturnBlocks()
    var
        DamageEntry: Record "CGR Damage Entry";
        Vehicle: Record "CGR Vehicle";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        InitHX072('HX072-R10');
        ContractNo := RentalMgt.CreateContract('HX072-R10', 'HX072 Customer', 20270301D, 20270303D);
        RentalMgt.CheckOut(ContractNo);
        Vehicle.Get('HX072-R10');
        Assert.IsTrue(Vehicle."Checked Out", 'The vehicle is checked out before the return');
        AssertHX072Vehicle('HX072-R10', false, 0, 'Before the return');

        RentalMgt.Return(ContractNo, 1100, 'Scratch');

        DamageEntry.SetRange("Vehicle No.", 'HX072-R10');
        Assert.AreEqual(1, DamageEntry.Count(), 'The damaged return registers one damage');
        DamageEntry.FindFirst();
        Assert.AreEqual(Enum::"CGR Damage Severity"::Major, DamageEntry.Severity, 'A damaged return registers a Major damage');
        AssertHX072Vehicle('HX072-R10', true, 1, 'After a damaged return');
    end;

    [Test]
    procedure RepairMinorKeepsCosmeticFree()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
        MinorEntryNo: Integer;
    begin
        InitHX072('HX072-R11');
        DamageMgt.RegisterDamageWithSeverity('HX072-R11', 'Scuffed seat', Enum::"CGR Damage Severity"::"HX072 Cosmetic");
        MinorEntryNo := DamageMgt.RegisterDamageWithSeverity('HX072-R11', 'Chipped paint', Enum::"CGR Damage Severity"::Minor);
        AssertHX072Vehicle('HX072-R11', false, 2, 'Before the repair (Cosmetic and Minor open)');

        DamageMgt.RepairDamage(MinorEntryNo);

        AssertHX072Vehicle('HX072-R11', false, 1, 'After repairing the Minor damage, only a non-blocking partner damage is open');
    end;

    [Test]
    procedure RepairDecidesThroughRule()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
        MinorEntryNo: Integer;
    begin
        InitHX072('HX072-R12');
        InsertHX072Damage('HX072-R12', 'Cracked frame', Enum::"CGR Damage Severity"::"HX072 Structural");
        MinorEntryNo := InsertHX072Damage('HX072-R12', 'Chipped paint', Enum::"CGR Damage Severity"::Minor);
        AssertHX072Vehicle('HX072-R12', false, 0, 'Before the repair (entries stored without registration)');

        DamageMgt.RepairDamage(MinorEntryNo);

        AssertHX072Vehicle('HX072-R12', true, 1, 'After repairing the Minor damage, the open Structural damage blocks');
    end;

    local procedure InsertHX072Damage(VehicleNo: Code[20]; Description: Text[100]; Severity: Enum "CGR Damage Severity"): Integer
    var
        DamageEntry: Record "CGR Damage Entry";
    begin
        DamageEntry.Init();
        DamageEntry."Vehicle No." := VehicleNo;
        DamageEntry.Description := Description;
        DamageEntry."Reported On" := WorkDate();
        DamageEntry.Severity := Severity;
        DamageEntry.Insert();
        exit(DamageEntry."Entry No.");
    end;

    local procedure InitHX072(VehicleNo: Code[20])
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
        Vehicle.Insert();
    end;

    local procedure AssertHX072Vehicle(VehicleNo: Code[20]; ExpectedBlocked: Boolean; ExpectedOpenDamages: Integer; Context: Text)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        Assert.AreEqual(ExpectedBlocked, Vehicle.Blocked, Context + ': Blocked');
        Assert.AreEqual(ExpectedOpenDamages, Vehicle."Open Damages", Context + ': Open Damages');
    end;
}
