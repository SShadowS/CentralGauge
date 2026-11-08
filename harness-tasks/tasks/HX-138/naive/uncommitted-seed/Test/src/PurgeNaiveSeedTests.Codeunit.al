codeunit 80468 "CGR Purge Naive Seed Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure SeedPurgeHonoursCutoff()
    var
        Entry: Record "CGR Outbox Entry";
        OutboxPurge: Codeunit "CGR Outbox Purge";
        AtCutoffNo: Integer;
    begin
        HX138SeedPrepare();
        Lib.CreateVehicle('HX138-NC1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        HX138SeedEntry('HX138-NC1', HX138SeedCutoff() - 1000);
        AtCutoffNo := HX138SeedEntry('HX138-NC1', HX138SeedCutoff());

        Assert.AreEqual(1, OutboxPurge.PurgeSent(HX138SeedCutoff()), 'One entry is older than the cutoff');
        Assert.IsTrue(Entry.Get(AtCutoffNo), 'Entry at the cutoff kept');
    end;

    [Test]
    procedure SeedPurgeSkipsHeldVehicle()
    var
        Entry: Record "CGR Outbox Entry";
        Vehicle: Record "CGR Vehicle";
        OutboxPurge: Codeunit "CGR Outbox Purge";
        HeldNo: Integer;
    begin
        HX138SeedPrepare();
        Lib.CreateVehicle('HX138-NH1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('HX138-NH2', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Vehicle.Get('HX138-NH1');
        Vehicle."Hold Outbox" := true;
        Vehicle.Modify();
        HeldNo := HX138SeedEntry('HX138-NH1', HX138SeedOld());
        HX138SeedEntry('HX138-NH2', HX138SeedOld());

        Assert.AreEqual(1, OutboxPurge.PurgeSent(HX138SeedCutoff()), 'Only the free vehicle entry is deleted');
        Assert.IsTrue(Entry.Get(HeldNo), 'Held vehicle entry kept');
    end;

    [Test]
    procedure SeedPurgeVetoAfterFiveHundred()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "CGR Purge Naive Seed Spy";
        OutboxPurge: Codeunit "CGR Outbox Purge";
        EntryNos: List of [Integer];
        Index: Integer;
    begin
        HX138SeedPrepare();
        Lib.CreateVehicle('HX138-NV1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        for Index := 1 to 600 do
            EntryNos.Add(HX138SeedEntry('HX138-NV1', HX138SeedOld()));
        Spy.VetoSeedPurgeOf(EntryNos.Get(550));
        BindSubscription(Spy);

        asserterror OutboxPurge.PurgeSent(HX138SeedCutoff());

        Assert.ExpectedError(Spy.SeedVetoText(EntryNos.Get(550)));
        Entry.SetRange("Vehicle No.", 'HX138-NV1');
        Assert.AreEqual(100, Entry.Count(), 'The saved 500 deletions stay deleted');
    end;

    [Test]
    procedure SeedPurgeShowsNoMessage()
    var
        OutboxPurge: Codeunit "CGR Outbox Purge";
    begin
        HX138SeedPrepare();
        Lib.CreateVehicle('HX138-NG1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        HX138SeedEntry('HX138-NG1', HX138SeedOld());

        Assert.AreEqual(1, OutboxPurge.PurgeSent(HX138SeedCutoff()), 'Deleted without a message');
    end;

    local procedure HX138SeedPrepare()
    var
        Entry: Record "CGR Outbox Entry";
    begin
        WorkDate(20240615D);
        Entry.SetFilter("Created At", '..%1', HX138SeedCutoff());
        Entry.DeleteAll();
    end;

    local procedure HX138SeedCutoff(): DateTime
    begin
        exit(CreateDateTime(20240601D, 120000T));
    end;

    local procedure HX138SeedOld(): DateTime
    begin
        exit(CreateDateTime(20240520D, 090000T));
    end;

    local procedure HX138SeedEntry(VehicleNo: Code[20]; CreatedAt: DateTime): Integer
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.Init();
        Entry."Vehicle No." := VehicleNo;
        Entry."Created At" := CreatedAt;
        Entry.Sent := true;
        Entry.Insert();
        exit(Entry."Entry No.");
    end;
}
