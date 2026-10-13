// Every row ends a hold left by an earlier row before it starts and ends its own afterwards (single-instance
// state and a SingleInstance binding outlive a procedure; unbinding through another local variable ends the
// binding). The unbind runs isolated in "HX059 Hold Cleaner" after Commit(), so a hold design whose unbind raises
// cannot fail a row. Every batch runs through the runner after Commit().
codeunit 86640 "HX059 Repair Batch Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure BatchRepairsAndReleases()
    var
        Hold: Codeunit "CGR Workshop Hold";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        EntryNos: List of [Integer];
        A1, B1, B2 : Integer;
    begin
        Prepare();
        CreateVehicle('HX059-1A');
        CreateVehicle('HX059-1B');
        A1 := RegisterDamage('HX059-1A');
        B1 := RegisterDamage('HX059-1B');
        B2 := RegisterDamage('HX059-1B');
        AssertVehicle('HX059-1A', true, 1);
        AssertVehicle('HX059-1B', true, 2);
        EntryNos.Add(A1);
        EntryNos.Add(B1);
        EntryNos.Add(B2);

        Assert.IsTrue(RunBatch(EntryNos), StrSubstNo('The batch succeeds: %1', GetLastErrorText()));

        AssertRepaired(A1, true);
        AssertRepaired(B1, true);
        AssertRepaired(B2, true);
        AssertVehicle('HX059-1A', false, 0);
        AssertVehicle('HX059-1B', false, 0);
        Assert.IsTrue(FleetMgt.IsAvailable('HX059-1A'), 'A repaired vehicle is available after the batch');
        Assert.IsTrue(FleetMgt.IsAvailable('HX059-1B'), 'A repaired vehicle is available after the batch');
        Assert.IsFalse(Hold.IsHeld('HX059-1A'), 'The hold ends with the batch');
        Assert.IsFalse(Hold.IsHeld('HX059-1B'), 'The hold ends with the batch');
        EndHold();
    end;

    [Test]
    procedure VehiclesHeldDuringBatch()
    var
        Hold: Codeunit "CGR Workshop Hold";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        Guard: Codeunit "HX059 Repair Guard";
        EntryNos: List of [Integer];
        A1, W1 : Integer;
    begin
        Prepare();
        CreateVehicle('HX059-2A');
        CreateVehicle('HX059-2W');
        CreateVehicle('HX059-2Z');
        CreateVehicle('HX059-2Y');
        A1 := RegisterDamage('HX059-2A');
        RegisterDamage('HX059-2Y');
        W1 := RepairedEntry('HX059-2W');
        Assert.IsTrue(FleetMgt.IsAvailable('HX059-2W'), 'Precondition: a vehicle whose damage is repaired is available');
        Assert.IsFalse(Hold.IsHeld('HX059-2W'), 'Precondition: the vehicle is not held before the batch');
        Assert.IsTrue(FleetMgt.IsAvailable('HX059-2Z'), 'Precondition: the control vehicle is available');
        Guard.Watch('HX059-2W', 'HX059-2Z', 'HX059-2Y');
        BindSubscription(Guard);
        EntryNos.Add(A1);
        EntryNos.Add(W1);

        Assert.IsTrue(RunBatch(EntryNos), StrSubstNo('The batch succeeds: %1', GetLastErrorText()));

        Assert.IsTrue(Guard.HasFired(), 'The batch repaired its entries');
        Assert.IsTrue(Guard.EntryVehicleWasHeld(), 'The vehicle of the entry being repaired is held during the batch');
        Assert.IsTrue(Guard.WatchedWasHeld(), 'Every vehicle of the batch is held while the batch runs');
        Assert.IsFalse(Guard.WatchedWasAvailable(), 'A held vehicle is not available at the desk while the batch runs');
        Assert.IsTrue(Guard.ControlWasAvailable(), 'A vehicle outside the batch stays available while the batch runs');
        Assert.IsFalse(Guard.BlockedControlWasAvailable(), 'A blocked vehicle outside the batch stays unavailable while the batch runs');
        Assert.IsTrue(FleetMgt.IsAvailable('HX059-2W'), 'The vehicle is available again after the batch');
        EndHold();
    end;

    [Test]
    procedure FailedBatchReleasesHold()
    var
        Hold: Codeunit "CGR Workshop Hold";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        EntryNos: List of [Integer];
        C1, Unknown : Integer;
        ExpectedError: Text;
    begin
        Prepare();
        CreateVehicle('HX059-3C');
        C1 := RepairedEntry('HX059-3C');
        Unknown := UnknownEntryNo();
        ExpectedError := RepairErrorOf(Unknown);
        Assert.IsTrue(FleetMgt.IsAvailable('HX059-3C'), 'Precondition: the vehicle is available before the batch');
        Assert.IsFalse(Hold.IsHeld('HX059-3C'), 'Precondition: the vehicle is not held before the batch');
        EntryNos.Add(C1);
        EntryNos.Add(Unknown);

        Assert.IsFalse(RunBatch(EntryNos), 'A batch with an unknown entry fails');

        Assert.AreEqual(ExpectedError, GetLastErrorText(), 'The batch fails with the error of the failing repair');
        Assert.IsFalse(Hold.IsHeld('HX059-3C'), 'The hold ends when the batch fails');
        Assert.IsTrue(FleetMgt.IsAvailable('HX059-3C'), 'The vehicle is available again after the failed batch');
        EndHold();
    end;

    [Test]
    procedure RefusedRepairKeepsNothingAndReleases()
    var
        Hold: Codeunit "CGR Workshop Hold";
        Guard: Codeunit "HX059 Repair Guard";
        EntryNos: List of [Integer];
        D1, D2 : Integer;
    begin
        Prepare();
        CreateVehicle('HX059-4D');
        D1 := RegisterDamage('HX059-4D');
        D2 := RegisterDamage('HX059-4D');
        Guard.Watch('HX059-4D', '', '');
        Guard.Refuse(D2);
        BindSubscription(Guard);
        EntryNos.Add(D1);
        EntryNos.Add(D2);

        Assert.IsFalse(RunBatch(EntryNos), 'A batch with a refused repair fails');

        Assert.AreEqual(Guard.RefusalText(), GetLastErrorText(), 'The batch fails with the extension''s error');
        Assert.IsTrue(Guard.HasFired(), 'Precondition: the batch reached the repairs');
        Assert.IsTrue(Guard.EntryVehicleWasHeld(), 'Precondition: the vehicle was held at its first repair');
        AssertRepaired(D1, false);
        AssertRepaired(D2, false);
        AssertVehicle('HX059-4D', true, 2);
        Assert.IsFalse(Hold.IsHeld('HX059-4D'), 'The hold ends when a repair of the batch is refused');
        EndHold();
    end;

    [Test]
    procedure NextBatchAfterFailure()
    var
        Hold: Codeunit "CGR Workshop Hold";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        FailingNos: List of [Integer];
        EntryNos: List of [Integer];
        C1, E1 : Integer;
    begin
        Prepare();
        CreateVehicle('HX059-5C');
        CreateVehicle('HX059-5E');
        C1 := RepairedEntry('HX059-5C');
        E1 := RegisterDamage('HX059-5E');
        FailingNos.Add(C1);
        FailingNos.Add(UnknownEntryNo());
        Assert.IsFalse(RunBatch(FailingNos), 'Precondition: the first batch fails');
        EntryNos.Add(E1);

        Assert.IsTrue(RunBatch(EntryNos), StrSubstNo('The next batch succeeds: %1', GetLastErrorText()));

        AssertRepaired(E1, true);
        Assert.IsTrue(FleetMgt.IsAvailable('HX059-5E'), 'The vehicle repaired by the next batch is available');
        Assert.IsFalse(Hold.IsHeld('HX059-5E'), 'The next batch ends its hold');
        EndHold();
    end;

    [Test]
    procedure OtherVehiclesAsToday()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
        EntryNos: List of [Integer];
    begin
        Prepare();
        CreateVehicle('HX059-6C');
        CreateVehicle('HX059-6F');
        CreateVehicle('HX059-6G');
        EntryNos.Add(RepairedEntry('HX059-6C'));
        RegisterDamage('HX059-6F');
        EntryNos.Add(UnknownEntryNo());
        Assert.IsFalse(RunBatch(EntryNos), 'Precondition: the batch fails');

        Assert.IsFalse(FleetMgt.IsAvailable('HX059-6F'), 'A vehicle with an open damage outside the batch stays unavailable');
        Assert.IsTrue(FleetMgt.IsAvailable('HX059-6G'), 'A free vehicle outside the batch stays available');
        EndHold();
    end;

    [Test]
    procedure EmptyBatch()
    var
        Hold: Codeunit "CGR Workshop Hold";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        EntryNos: List of [Integer];
        H1: Integer;
    begin
        Prepare();
        CreateVehicle('HX059-7H');
        CreateVehicle('HX059-7K');
        H1 := RegisterDamage('HX059-7H');

        Assert.IsTrue(RunBatch(EntryNos), StrSubstNo('An empty batch succeeds: %1', GetLastErrorText()));

        AssertRepaired(H1, false);
        AssertVehicle('HX059-7H', true, 1);
        Assert.IsFalse(Hold.IsHeld('HX059-7H'), 'An empty batch holds nothing');
        Assert.IsFalse(Hold.IsHeld('HX059-7K'), 'An empty batch holds nothing');
        Assert.IsTrue(FleetMgt.IsAvailable('HX059-7K'), 'A free vehicle stays available');
        EndHold();
    end;

    [Test]
    procedure AlreadyRepairedEntryInBatch()
    var
        Hold: Codeunit "CGR Workshop Hold";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        EntryNos: List of [Integer];
        C1: Integer;
    begin
        Prepare();
        CreateVehicle('HX059-8C');
        C1 := RepairedEntry('HX059-8C');
        EntryNos.Add(C1);

        Assert.IsTrue(RunBatch(EntryNos), StrSubstNo('Repairing a repaired entry succeeds: %1', GetLastErrorText()));

        AssertRepaired(C1, true);
        AssertVehicle('HX059-8C', false, 0);
        Assert.IsTrue(FleetMgt.IsAvailable('HX059-8C'), 'The vehicle is available after the batch');
        Assert.IsFalse(Hold.IsHeld('HX059-8C'), 'The hold ends with the batch');
        EndHold();
    end;

    local procedure RunBatch(EntryNos: List of [Integer]): Boolean
    var
        Runner: Codeunit "HX059 Batch Runner";
    begin
        Commit();
        Runner.SetBatch(EntryNos);
        exit(Runner.Run());
    end;

    local procedure RepairErrorOf(EntryNo: Integer): Text
    var
        Runner: Codeunit "HX059 Batch Runner";
        ErrorText: Text;
    begin
        Commit();
        Runner.SetSingleRepair(EntryNo);
        Assert.IsFalse(Runner.Run(), 'Precondition: repairing an unknown entry fails');
        ErrorText := GetLastErrorText();
        Assert.AreNotEqual('', ErrorText, 'Precondition: the failing repair has an error text');
        exit(ErrorText);
    end;

    local procedure RegisterDamage(VehicleNo: Code[20]): Integer
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
    begin
        exit(DamageMgt.RegisterDamage(VehicleNo, 'HX059 damage'));
    end;

    local procedure RepairedEntry(VehicleNo: Code[20]): Integer
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
        EntryNo: Integer;
    begin
        EntryNo := RegisterDamage(VehicleNo);
        DamageMgt.RepairDamage(EntryNo);
        AssertVehicle(VehicleNo, false, 0);
        exit(EntryNo);
    end;

    local procedure UnknownEntryNo(): Integer
    var
        DamageEntry: Record "CGR Damage Entry";
    begin
        if DamageEntry.FindLast() then
            exit(DamageEntry."Entry No." + 1000);
        exit(1000);
    end;

    local procedure AssertRepaired(EntryNo: Integer; Expected: Boolean)
    var
        DamageEntry: Record "CGR Damage Entry";
    begin
        DamageEntry.Get(EntryNo);
        Assert.AreEqual(Expected, DamageEntry.Repaired, StrSubstNo('Repaired of damage entry %1', EntryNo));
    end;

    local procedure AssertVehicle(VehicleNo: Code[20]; ExpectedBlocked: Boolean; ExpectedOpenDamages: Integer)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        Assert.AreEqual(ExpectedBlocked, Vehicle.Blocked, StrSubstNo('Blocked of %1', VehicleNo));
        Assert.AreEqual(ExpectedOpenDamages, Vehicle."Open Damages", StrSubstNo('Open Damages of %1', VehicleNo));
    end;

    local procedure CreateVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle.Insert();
    end;

    local procedure EndHold()
    var
        Hold: Codeunit "CGR Workshop Hold";
        HoldCleaner: Codeunit "HX059 Hold Cleaner";
    begin
        Commit();
        if HoldCleaner.Run() then;
        Hold.ReleaseAll();
    end;

    local procedure Prepare()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        EndHold();
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := 0;
        Setup."Km Allowance per Day" := 1000;
        Setup."Excess Km Rate" := 0;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
    end;
}
