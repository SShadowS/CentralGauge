codeunit 80465 "CGR Purge Naive Basic Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure BasicPurgeDeletesOnlySent()
    var
        Entry: Record "CGR Outbox Entry";
        OutboxPurge: Codeunit "CGR Outbox Purge";
        UnsentNo: Integer;
        FailedNo: Integer;
    begin
        HX138BasicPrepare();
        Lib.CreateVehicle('HX138-BU1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        HX138BasicEntry('HX138-BU1', true, false);
        HX138BasicEntry('HX138-BU1', true, false);
        UnsentNo := HX138BasicEntry('HX138-BU1', false, false);
        FailedNo := HX138BasicEntry('HX138-BU1', false, true);

        Commit();
        Assert.AreEqual(2, OutboxPurge.PurgeSent(HX138BasicCutoff()), 'Two sent entries deleted');
        Assert.IsTrue(Entry.Get(UnsentNo), 'Unsent entry kept');
        Assert.IsTrue(Entry.Get(FailedNo), 'Failed entry kept');
    end;

    [Test]
    procedure BasicVetoKeepsSavedWork()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "CGR Purge Naive Basic Spy";
        OutboxPurge: Codeunit "CGR Outbox Purge";
        EntryNos: List of [Integer];
        Index: Integer;
    begin
        HX138BasicPrepare();
        Lib.CreateVehicle('HX138-BV1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        for Index := 1 to 600 do
            EntryNos.Add(HX138BasicEntry('HX138-BV1', true, false));
        Spy.VetoBasicPurgeOf(EntryNos.Get(550));
        BindSubscription(Spy);

        Commit();
        asserterror OutboxPurge.PurgeSent(HX138BasicCutoff());

        Assert.ExpectedError(Spy.BasicVetoText(EntryNos.Get(550)));
        Entry.SetRange("Vehicle No.", 'HX138-BV1');
        Assert.AreEqual(100, Entry.Count(), 'The first 500 deletions are saved');
    end;

    [Test]
    procedure BasicPurgeRunsUnattended()
    var
        Runner: Codeunit "CGR Purge Naive Basic Runner";
        Ok: Boolean;
    begin
        HX138BasicPrepare();
        Lib.CreateVehicle('HX138-BG1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        HX138BasicEntry('HX138-BG1', true, false);
        Runner.SetBasicRun(HX138BasicCutoff());

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Runs without UI: ' + GetLastErrorText());
        Assert.AreEqual(1, Runner.BasicDeletedCount(), 'One entry deleted');
    end;

    local procedure HX138BasicPrepare()
    var
        Entry: Record "CGR Outbox Entry";
    begin
        WorkDate(20240615D);
        Entry.SetFilter("Created At", '..%1', HX138BasicCutoff());
        Entry.DeleteAll();
    end;

    local procedure HX138BasicCutoff(): DateTime
    begin
        exit(CreateDateTime(20240601D, 120000T));
    end;

    local procedure HX138BasicEntry(VehicleNo: Code[20]; IsSent: Boolean; IsFailed: Boolean): Integer
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.Init();
        Entry."Vehicle No." := VehicleNo;
        Entry."Created At" := CreateDateTime(20240401D, 080000T);
        Entry.Sent := IsSent;
        Entry.Failed := IsFailed;
        Entry.Insert();
        exit(Entry."Entry No.");
    end;
}
