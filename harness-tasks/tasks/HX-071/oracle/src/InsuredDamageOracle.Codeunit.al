codeunit 86880 "HX071 Insured Damage Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        RefusedTxt: Label 'HX071 insurer refused %1.', Locked = true;
        LaterStepTxt: Label 'HX071 later step failed.', Locked = true;

    [Test]
    procedure AcceptedDamageRegistered()
    var
        DamageEntry: Record "CGR Damage Entry";
        Partner: Codeunit "HX071 Insurer Partner";
        Runner: Codeunit "HX071 Register Runner";
        Spy: Codeunit "HX071 Registered Spy";
        Ok: Boolean;
    begin
        InitHX071('HX071-1A', 20270301D);
        ClearHX071Marker('HX071-MARK-1');
        Partner.SetHX071Mode('HX071-1A', 1, 'HX071-MARK-1');
        BindSubscription(Partner);
        BindSubscription(Spy);
        Commit();

        Runner.SetHX071Damage('HX071-1A', 'Dent', false);
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Registering a damage the insurer accepts succeeds: ' + GetLastErrorText());
        Assert.AreEqual(1, Partner.HX071Calls(), 'The insurer app checks the damage once');
        FindHX071Entry(DamageEntry, 'HX071-1A', 1);
        Assert.AreEqual(DamageEntry."Entry No.", Runner.HX071EntryNo(), 'RegisterInsuredDamage returns the Entry No. of the stored entry');
        Assert.AreEqual(1, Spy.HX071Raised(), 'OnAfterDamageRegistered is raised once per registration');
        Assert.AreEqual(DamageEntry."Entry No.", Spy.HX071RaisedEntryNo(), 'OnAfterDamageRegistered carries the stored entry');
        Assert.AreEqual('Dent', DamageEntry.Description, 'Description');
        Assert.AreEqual(20270301D, DamageEntry."Reported On", 'Reported On is the work date');
        Assert.IsFalse(DamageEntry.Repaired, 'Repaired');
        Assert.IsFalse(DamageEntry."Insurer Pending", 'An accepted damage is not insurer pending');
        Assert.AreEqual('', DamageEntry."Insurer Message", 'An accepted damage has no insurer message');
        AssertHX071Vehicle('HX071-1A', true, 1, 'An accepted insured damage');
        Assert.AreEqual(1, CountHX071Marker('HX071-MARK-1'), 'What the insurer app writes during a check it accepts is kept');
    end;

    [Test]
    procedure RefusedDamageStoredPending()
    var
        DamageEntry: Record "CGR Damage Entry";
        Partner: Codeunit "HX071 Insurer Partner";
        Runner: Codeunit "HX071 Register Runner";
        Spy: Codeunit "HX071 Registered Spy";
        Ok: Boolean;
    begin
        InitHX071('HX071-2B', 20270412D);
        Partner.SetHX071Mode('HX071-2B', 2, '');
        BindSubscription(Partner);
        BindSubscription(Spy);
        Commit();

        Runner.SetHX071Damage('HX071-2B', 'Cracked mirror', false);
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Registering a damage the insurer refuses succeeds: ' + GetLastErrorText());
        FindHX071Entry(DamageEntry, 'HX071-2B', 1);
        Assert.AreEqual(DamageEntry."Entry No.", Runner.HX071EntryNo(), 'RegisterInsuredDamage returns the Entry No. of the stored entry');
        Assert.AreEqual(1, Spy.HX071Raised(), 'OnAfterDamageRegistered is raised once per registration');
        Assert.AreEqual(DamageEntry."Entry No.", Spy.HX071RaisedEntryNo(), 'OnAfterDamageRegistered carries the stored entry');
        Assert.AreEqual('Cracked mirror', DamageEntry.Description, 'Description');
        Assert.AreEqual(20270412D, DamageEntry."Reported On", 'Reported On is the work date');
        Assert.IsFalse(DamageEntry.Repaired, 'Repaired');
        Assert.IsTrue(DamageEntry."Insurer Pending", 'A refused damage is insurer pending');
        Assert.AreEqual(StrSubstNo(RefusedTxt, 'HX071-2B'), DamageEntry."Insurer Message", 'The refusal text is stored');
        AssertHX071Vehicle('HX071-2B', true, 1, 'A refused insured damage');
    end;

    [Test]
    procedure RefusedCheckWritesNothing()
    var
        DamageEntry: Record "CGR Damage Entry";
        Partner: Codeunit "HX071 Insurer Partner";
        Runner: Codeunit "HX071 Register Runner";
        Ok: Boolean;
    begin
        InitHX071('HX071-3C', 20270301D);
        ClearHX071Marker('HX071-MARK-3');
        Partner.SetHX071Mode('HX071-3C', 3, 'HX071-MARK-3');
        BindSubscription(Partner);
        Commit();

        Runner.SetHX071Damage('HX071-3C', 'Broken lamp', false);
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Registering a damage the insurer refuses succeeds: ' + GetLastErrorText());
        Assert.AreEqual(1, Partner.HX071Calls(), 'The insurer app checks the damage once');
        Assert.AreEqual(1, Partner.HX071MarkersQueued(), 'Precondition: the insurer app wrote during the check');
        Assert.AreEqual(0, CountHX071Marker('HX071-MARK-3'), 'What the insurer app writes during a check it refuses is not kept');
        FindHX071Entry(DamageEntry, 'HX071-3C', 1);
        Assert.IsTrue(DamageEntry."Insurer Pending", 'A refused damage is insurer pending');
        Assert.AreEqual(StrSubstNo(RefusedTxt, 'HX071-3C'), DamageEntry."Insurer Message", 'The refusal text is stored');
        AssertHX071Vehicle('HX071-3C', true, 1, 'A refused insured damage');
    end;

    [Test]
    procedure CheckSeesDamageBeforeStoring()
    var
        DamageEntry: Record "CGR Damage Entry";
        Partner: Codeunit "HX071 Insurer Partner";
        Runner: Codeunit "HX071 Register Runner";
        Ok: Boolean;
    begin
        InitHX071('HX071-4D', 20270301D);
        ClearHX071Marker('HX071-MARK-4');
        Partner.SetHX071Mode('HX071-4D', 1, 'HX071-MARK-4');
        BindSubscription(Partner);
        Commit();

        Runner.SetHX071Damage('HX071-4D', 'Scratch', false);
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Registering a damage the insurer accepts succeeds: ' + GetLastErrorText());
        Assert.AreEqual(1, Partner.HX071Calls(), 'The insurer app checks the damage once');
        Assert.AreEqual('HX071-4D', Partner.HX071LastVehicle(), 'The check receives the vehicle');
        Assert.AreEqual('Scratch', Partner.HX071LastDescription(), 'The check receives the description');
        Assert.AreEqual(0, Partner.HX071StoredAtCall(), 'The damage is checked before it is stored');
        FindHX071Entry(DamageEntry, 'HX071-4D', 1);
    end;

    [Test]
    procedure LaterFailureKeepsNothing()
    var
        DamageEntry: Record "CGR Damage Entry";
        Partner: Codeunit "HX071 Insurer Partner";
        Runner: Codeunit "HX071 Register Runner";
        Ok: Boolean;
    begin
        InitHX071('HX071-5E', 20270301D);
        Partner.SetHX071Mode('HX071-5E', 0, '');
        BindSubscription(Partner);
        Commit();

        Runner.SetHX071Damage('HX071-5E', 'Dent', true);
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'The caller''s later step fails');
        Assert.AreEqual(LaterStepTxt, GetLastErrorText(), 'The registration itself succeeded; only the caller''s later step failed');
        Assert.AreEqual(1, Partner.HX071Calls(), 'Precondition: the registration ran its insurer check');
        DamageEntry.SetRange("Vehicle No.", 'HX071-5E');
        Assert.AreEqual(0, DamageEntry.Count(), 'Registering commits nothing: no damage entry is kept after the caller fails');
        AssertHX071Vehicle('HX071-5E', false, 0, 'After the caller fails');
    end;

    [Test]
    procedure NoInsurerAppAccepts()
    var
        DamageEntry: Record "CGR Damage Entry";
        Runner: Codeunit "HX071 Register Runner";
        Spy: Codeunit "HX071 Registered Spy";
        Ok: Boolean;
    begin
        InitHX071('HX071-6F', 20270301D);
        BindSubscription(Spy);
        Commit();

        Runner.SetHX071Damage('HX071-6F', 'Worn tyre', false);
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Registering an insured damage with no insurer app succeeds: ' + GetLastErrorText());
        FindHX071Entry(DamageEntry, 'HX071-6F', 1);
        Assert.AreEqual(DamageEntry."Entry No.", Runner.HX071EntryNo(), 'RegisterInsuredDamage returns the Entry No. of the stored entry');
        Assert.AreEqual(1, Spy.HX071Raised(), 'OnAfterDamageRegistered is raised once per registration');
        Assert.AreEqual(DamageEntry."Entry No.", Spy.HX071RaisedEntryNo(), 'OnAfterDamageRegistered carries the stored entry');
        Assert.IsFalse(DamageEntry."Insurer Pending", 'With no insurer app the damage is not insurer pending');
        Assert.AreEqual('', DamageEntry."Insurer Message", 'With no insurer app there is no insurer message');
        AssertHX071Vehicle('HX071-6F', true, 1, 'An insured damage with no insurer app');
    end;

    [Test]
    procedure TwoDamagesOneVehicle()
    var
        DamageEntry: Record "CGR Damage Entry";
        Partner: Codeunit "HX071 Insurer Partner";
        FirstRunner: Codeunit "HX071 Register Runner";
        SecondRunner: Codeunit "HX071 Register Runner";
        Ok: Boolean;
    begin
        InitHX071('HX071-7G', 20270301D);
        ClearHX071Marker('HX071-MARK-7');
        Partner.SetHX071Mode('HX071-7G', 1, 'HX071-MARK-7');
        BindSubscription(Partner);
        Commit();

        FirstRunner.SetHX071Damage('HX071-7G', 'Dent', false);
        Ok := FirstRunner.Run();
        Assert.IsTrue(Ok, 'The first, accepted registration succeeds: ' + GetLastErrorText());

        Partner.SetHX071Mode('HX071-7G', 2, '');
        Commit();
        SecondRunner.SetHX071Damage('HX071-7G', 'Bent rim', false);
        Ok := SecondRunner.Run();
        Assert.IsTrue(Ok, 'The second, refused registration succeeds: ' + GetLastErrorText());

        DamageEntry.SetRange("Vehicle No.", 'HX071-7G');
        Assert.AreEqual(2, DamageEntry.Count(), 'Both damages are stored');
        DamageEntry.SetRange(Description, 'Dent');
        DamageEntry.FindFirst();
        Assert.AreEqual(FirstRunner.HX071EntryNo(), DamageEntry."Entry No.", 'The first registration returns its own entry');
        Assert.IsFalse(DamageEntry."Insurer Pending", 'The accepted damage is not insurer pending');
        Assert.AreEqual('', DamageEntry."Insurer Message", 'The accepted damage has no insurer message');
        DamageEntry.SetRange(Description, 'Bent rim');
        DamageEntry.FindFirst();
        Assert.AreEqual(SecondRunner.HX071EntryNo(), DamageEntry."Entry No.", 'The second registration returns its own entry');
        Assert.IsTrue(DamageEntry."Insurer Pending", 'The refused damage is insurer pending');
        Assert.AreEqual(StrSubstNo(RefusedTxt, 'HX071-7G'), DamageEntry."Insurer Message", 'The refusal text is stored');
        AssertHX071Vehicle('HX071-7G', true, 2, 'Two insured damages');
        Assert.AreEqual(1, CountHX071Marker('HX071-MARK-7'), 'The accepting check''s write is kept');
    end;

    [Test]
    procedure LongRefusalCut()
    var
        DamageEntry: Record "CGR Damage Entry";
        Partner: Codeunit "HX071 Insurer Partner";
        Runner: Codeunit "HX071 Register Runner";
        LongText: Text;
        Ok: Boolean;
    begin
        InitHX071('HX071-8H', 20270301D);
        LongText := 'HX071 long refusal ';
        while StrLen(LongText) < 300 do
            LongText += '0123456789';
        LongText := CopyStr(LongText, 1, 300);
        Assert.AreEqual(300, StrLen(LongText), 'Precondition: the refusal text has 300 characters');
        Partner.SetHX071Mode('HX071-8H', 4, '');
        Partner.SetHX071RefusalText(LongText);
        BindSubscription(Partner);
        Commit();

        Runner.SetHX071Damage('HX071-8H', 'Hail damage', false);
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Registering a damage the insurer refuses succeeds: ' + GetLastErrorText());
        FindHX071Entry(DamageEntry, 'HX071-8H', 1);
        Assert.IsTrue(DamageEntry."Insurer Pending", 'A refused damage is insurer pending');
        Assert.AreEqual(CopyStr(LongText, 1, 250), DamageEntry."Insurer Message", 'Insurer Message keeps the first 250 characters of the refusal');
    end;

    [Test]
    procedure RegisterDamageAsToday()
    var
        DamageEntry: Record "CGR Damage Entry";
        Partner: Codeunit "HX071 Insurer Partner";
        DamageMgt: Codeunit "CGR Damage Mgt";
        EntryNo: Integer;
    begin
        InitHX071('HX071-9J', 20270301D);
        Partner.SetHX071Mode('HX071-9J', 2, '');
        BindSubscription(Partner);

        EntryNo := DamageMgt.RegisterDamage('HX071-9J', 'Dent');

        Assert.AreEqual(0, Partner.HX071Calls(), 'RegisterDamage runs no insurer check');
        FindHX071Entry(DamageEntry, 'HX071-9J', 1);
        Assert.AreEqual(DamageEntry."Entry No.", EntryNo, 'RegisterDamage returns the Entry No.');
        Assert.IsFalse(DamageEntry."Insurer Pending", 'RegisterDamage stores no insurer pending flag');
        Assert.AreEqual('', DamageEntry."Insurer Message", 'RegisterDamage stores no insurer message');
        AssertHX071Vehicle('HX071-9J', true, 1, 'RegisterDamage');
    end;

    local procedure InitHX071(VehicleNo: Code[20]; NewWorkDate: Date)
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
    begin
        WorkDate(NewWorkDate);
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle.Insert();
    end;

    local procedure ClearHX071Marker(MarkerNo: Code[20])
    var
        OutboxEntry: Record "CGR Outbox Entry";
    begin
        OutboxEntry.SetRange("Vehicle No.", MarkerNo);
        OutboxEntry.DeleteAll();
    end;

    local procedure CountHX071Marker(MarkerNo: Code[20]): Integer
    var
        OutboxEntry: Record "CGR Outbox Entry";
    begin
        OutboxEntry.SetRange("Vehicle No.", MarkerNo);
        exit(OutboxEntry.Count());
    end;

    local procedure FindHX071Entry(var DamageEntry: Record "CGR Damage Entry"; VehicleNo: Code[20]; ExpectedCount: Integer)
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        Assert.AreEqual(ExpectedCount, DamageEntry.Count(), 'Damage entries stored for ' + VehicleNo);
        DamageEntry.FindFirst();
        Assert.AreEqual(VehicleNo, DamageEntry."Vehicle No.", 'Vehicle No.');
    end;

    local procedure AssertHX071Vehicle(VehicleNo: Code[20]; ExpectedBlocked: Boolean; ExpectedOpenDamages: Integer; Context: Text)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        Assert.AreEqual(ExpectedBlocked, Vehicle.Blocked, Context + ': Blocked');
        Assert.AreEqual(ExpectedOpenDamages, Vehicle."Open Damages", Context + ': Open Damages');
    end;
}
