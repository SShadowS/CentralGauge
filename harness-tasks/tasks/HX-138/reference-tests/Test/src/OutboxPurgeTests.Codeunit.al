codeunit 80460 "CGR Outbox Purge Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure KeepsUnsentAndFailedEntries()
    var
        Entry: Record "CGR Outbox Entry";
        OutboxPurge: Codeunit "CGR Outbox Purge";
        SentNo: Integer;
        UnsentNo: Integer;
        FailedNo: Integer;
        SentFailedNo: Integer;
        Deleted: Integer;
    begin
        HX138Prepare();
        Lib.CreateVehicle('HX138-U1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        SentNo := HX138Entry('HX138-U1', HX138OldTime(), true, false);
        UnsentNo := HX138Entry('HX138-U1', HX138OldTime(), false, false);
        FailedNo := HX138Entry('HX138-U1', HX138OldTime(), false, true);
        SentFailedNo := HX138Entry('HX138-U1', HX138OldTime(), true, true);

        Commit();
        Deleted := OutboxPurge.PurgeSent(HX138Cutoff());

        Assert.AreEqual(1, Deleted, 'Only the old sent entry is deleted');
        Assert.IsFalse(Entry.Get(SentNo), 'The old sent entry is deleted');
        Assert.IsTrue(Entry.Get(UnsentNo), 'An unsent entry is never deleted');
        Assert.IsTrue(Entry.Get(FailedNo), 'A failed entry is never deleted');
        Assert.IsTrue(Entry.Get(SentFailedNo), 'A failed entry is never deleted, also when it is marked sent');
    end;

    [Test]
    procedure KeepsEntryCreatedAtCutoff()
    var
        Entry: Record "CGR Outbox Entry";
        OutboxPurge: Codeunit "CGR Outbox Purge";
        BeforeNo: Integer;
        AtCutoffNo: Integer;
        Deleted: Integer;
    begin
        HX138Prepare();
        Lib.CreateVehicle('HX138-C1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        BeforeNo := HX138Entry('HX138-C1', HX138Cutoff() - 60000, true, false);
        AtCutoffNo := HX138Entry('HX138-C1', HX138Cutoff(), true, false);

        Commit();
        Deleted := OutboxPurge.PurgeSent(HX138Cutoff());

        Assert.AreEqual(1, Deleted, 'Only the entry created before OlderThan is deleted');
        Assert.IsFalse(Entry.Get(BeforeNo), 'The entry created a minute before OlderThan is deleted');
        Assert.IsTrue(Entry.Get(AtCutoffNo), 'The entry created at OlderThan is kept');
    end;

    [Test]
    procedure KeepsEntriesOfHeldVehicles()
    var
        Entry: Record "CGR Outbox Entry";
        Vehicle: Record "CGR Vehicle";
        OutboxPurge: Codeunit "CGR Outbox Purge";
        HeldNo: Integer;
        FreeNo: Integer;
        Deleted: Integer;
    begin
        HX138Prepare();
        Lib.CreateVehicle('HX138-H1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('HX138-H2', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Vehicle.Get('HX138-H1');
        Vehicle."Hold Outbox" := true;
        Vehicle.Modify();
        HeldNo := HX138Entry('HX138-H1', HX138OldTime(), true, false);
        FreeNo := HX138Entry('HX138-H2', HX138OldTime(), true, false);

        Commit();
        Deleted := OutboxPurge.PurgeSent(HX138Cutoff());

        Assert.AreEqual(1, Deleted, 'The result counts the deleted entry only');
        Assert.IsTrue(Entry.Get(HeldNo), 'The entry of a held vehicle is kept');
        Assert.IsFalse(Entry.Get(FreeNo), 'The entry of a vehicle that is not held is deleted');
    end;

    [Test]
    procedure VetoAfterFiveHundredKeepsSavedDeletions()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "CGR Purge Veto Spy";
        OutboxPurge: Codeunit "CGR Outbox Purge";
        EntryNos: List of [Integer];
        Index: Integer;
    begin
        HX138Prepare();
        Lib.CreateVehicle('HX138-B1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        for Index := 1 to 600 do
            EntryNos.Add(HX138Entry('HX138-B1', HX138OldTime(), true, false));
        Spy.VetoPurgeOf(EntryNos.Get(550));
        BindSubscription(Spy);

        Commit();
        asserterror OutboxPurge.PurgeSent(HX138Cutoff());

        Assert.ExpectedError(Spy.PurgeVetoText(EntryNos.Get(550)));
        Entry.SetRange("Vehicle No.", 'HX138-B1');
        Assert.AreEqual(100, Entry.Count(), 'The 500 deletions saved before the veto stay deleted');
        Assert.IsFalse(Entry.Get(EntryNos.Get(500)), 'The 500th deleted entry stays deleted');
        Assert.IsTrue(Entry.Get(EntryNos.Get(501)), 'A deletion after the last save is undone');
        Assert.IsTrue(Entry.Get(EntryNos.Get(550)), 'The vetoed entry is kept');
    end;

    [Test]
    procedure ShowsNothingWithoutUserInterface()
    var
        Entry: Record "CGR Outbox Entry";
        Runner: Codeunit "CGR Outbox Purge Runner";
        Ok: Boolean;
    begin
        HX138Prepare();
        Lib.CreateVehicle('HX138-G1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        HX138Entry('HX138-G1', HX138OldTime(), true, false);
        HX138Entry('HX138-G1', HX138OldTime(), true, false);
        Runner.SetPurgeRun(HX138Cutoff());

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The purge runs without a user interface and shows nothing: ' + GetLastErrorText());
        Assert.AreEqual(2, Runner.DeletedInPurgeRun(), 'Both old sent entries are deleted');
        Entry.SetRange("Vehicle No.", 'HX138-G1');
        Assert.AreEqual(0, Entry.Count(), 'No old sent entry is left');
    end;

    local procedure HX138Prepare()
    var
        Entry: Record "CGR Outbox Entry";
    begin
        WorkDate(20240615D);
        Entry.SetFilter("Created At", '..%1', HX138Cutoff());
        Entry.DeleteAll();
    end;

    local procedure HX138Cutoff(): DateTime
    begin
        exit(CreateDateTime(20240601D, 120000T));
    end;

    local procedure HX138OldTime(): DateTime
    begin
        exit(CreateDateTime(20240501D, 120000T));
    end;

    local procedure HX138Entry(VehicleNo: Code[20]; CreatedAt: DateTime; IsSent: Boolean; IsFailed: Boolean): Integer
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.Init();
        Entry."Event Type" := 'HX138 test';
        Entry."Vehicle No." := VehicleNo;
        Entry."Created At" := CreatedAt;
        Entry.Sent := IsSent;
        Entry.Failed := IsFailed;
        Entry.Insert();
        exit(Entry."Entry No.");
    end;
}
