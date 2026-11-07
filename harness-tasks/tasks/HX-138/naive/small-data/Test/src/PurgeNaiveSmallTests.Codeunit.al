codeunit 80463 "CGR Purge Naive Small Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure SmallPurgeKeepsUnsentAndFailed()
    var
        Entry: Record "CGR Outbox Entry";
        OutboxPurge: Codeunit "CGR Outbox Purge";
        SentNo: Integer;
        UnsentNo: Integer;
        FailedNo: Integer;
    begin
        HX138SmallPrepare();
        Lib.CreateVehicle('HX138-SU1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        SentNo := HX138SmallEntry('HX138-SU1', HX138SmallOld(), true, false);
        UnsentNo := HX138SmallEntry('HX138-SU1', HX138SmallOld(), false, false);
        FailedNo := HX138SmallEntry('HX138-SU1', HX138SmallOld(), false, true);

        Commit();
        Assert.AreEqual(1, OutboxPurge.PurgeSent(HX138SmallCutoff()), 'One sent entry deleted');
        Assert.IsFalse(Entry.Get(SentNo), 'Sent entry deleted');
        Assert.IsTrue(Entry.Get(UnsentNo), 'Unsent entry kept');
        Assert.IsTrue(Entry.Get(FailedNo), 'Failed entry kept');
    end;

    [Test]
    procedure SmallPurgeKeepsEntryAtCutoff()
    var
        Entry: Record "CGR Outbox Entry";
        OutboxPurge: Codeunit "CGR Outbox Purge";
        AtCutoffNo: Integer;
    begin
        HX138SmallPrepare();
        Lib.CreateVehicle('HX138-SC1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        HX138SmallEntry('HX138-SC1', HX138SmallOld(), true, false);
        AtCutoffNo := HX138SmallEntry('HX138-SC1', HX138SmallCutoff(), true, false);

        Commit();
        Assert.AreEqual(1, OutboxPurge.PurgeSent(HX138SmallCutoff()), 'One entry before the cutoff');
        Assert.IsTrue(Entry.Get(AtCutoffNo), 'Entry at the cutoff kept');
    end;

    [Test]
    procedure SmallPurgeKeepsHeldVehicle()
    var
        Entry: Record "CGR Outbox Entry";
        Vehicle: Record "CGR Vehicle";
        OutboxPurge: Codeunit "CGR Outbox Purge";
        HeldNo: Integer;
    begin
        HX138SmallPrepare();
        Lib.CreateVehicle('HX138-SH1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('HX138-SH2', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Vehicle.Get('HX138-SH1');
        Vehicle."Hold Outbox" := true;
        Vehicle.Modify();
        HeldNo := HX138SmallEntry('HX138-SH1', HX138SmallOld(), true, false);
        HX138SmallEntry('HX138-SH2', HX138SmallOld(), true, false);

        Commit();
        Assert.AreEqual(1, OutboxPurge.PurgeSent(HX138SmallCutoff()), 'Held entry not counted');
        Assert.IsTrue(Entry.Get(HeldNo), 'Held entry kept');
    end;

    [Test]
    procedure SmallPurgeVetoUndoesEverything()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "CGR Purge Naive Small Spy";
        OutboxPurge: Codeunit "CGR Outbox Purge";
        VetoedNo: Integer;
    begin
        HX138SmallPrepare();
        Lib.CreateVehicle('HX138-SV1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        HX138SmallEntry('HX138-SV1', HX138SmallOld(), true, false);
        VetoedNo := HX138SmallEntry('HX138-SV1', HX138SmallOld(), true, false);
        HX138SmallEntry('HX138-SV1', HX138SmallOld(), true, false);
        Spy.VetoSmallPurgeOf(VetoedNo);
        BindSubscription(Spy);

        Commit();
        asserterror OutboxPurge.PurgeSent(HX138SmallCutoff());

        Assert.ExpectedError(Spy.SmallVetoText(VetoedNo));
        Entry.SetRange("Vehicle No.", 'HX138-SV1');
        Assert.AreEqual(3, Entry.Count(), 'Fewer than 500 deletions: everything is undone');
    end;

    [Test]
    procedure SmallPurgeShowsNothing()
    var
        OutboxPurge: Codeunit "CGR Outbox Purge";
    begin
        HX138SmallPrepare();
        Lib.CreateVehicle('HX138-SG1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        HX138SmallEntry('HX138-SG1', HX138SmallOld(), true, false);
        HX138SmallEntry('HX138-SG1', HX138SmallOld(), true, false);

        Commit();
        Assert.AreEqual(2, OutboxPurge.PurgeSent(HX138SmallCutoff()), 'Both entries deleted without a message');
    end;

    local procedure HX138SmallPrepare()
    var
        Entry: Record "CGR Outbox Entry";
    begin
        WorkDate(20240615D);
        Entry.SetFilter("Created At", '..%1', HX138SmallCutoff());
        Entry.DeleteAll();
    end;

    local procedure HX138SmallCutoff(): DateTime
    begin
        exit(CreateDateTime(20240601D, 120000T));
    end;

    local procedure HX138SmallOld(): DateTime
    begin
        exit(CreateDateTime(20240501D, 120000T));
    end;

    local procedure HX138SmallEntry(VehicleNo: Code[20]; CreatedAt: DateTime; IsSent: Boolean; IsFailed: Boolean): Integer
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.Init();
        Entry."Vehicle No." := VehicleNo;
        Entry."Created At" := CreatedAt;
        Entry.Sent := IsSent;
        Entry.Failed := IsFailed;
        Entry.Insert();
        exit(Entry."Entry No.");
    end;
}
