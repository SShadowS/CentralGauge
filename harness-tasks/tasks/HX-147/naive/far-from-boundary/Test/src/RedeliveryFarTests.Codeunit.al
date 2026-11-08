codeunit 80543 "CGR Redelivery Far Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure FarNeverAttemptedIsDue()
    var
        Redelivery: Codeunit "CGR Outbox Redelivery";
        EntryNo: Integer;
    begin
        HX147FarPrepare();
        EntryNo := Lib.QueueOutboxEntry('HX147-FN1');
        Assert.IsTrue(Redelivery.IsDue(EntryNo, HX147FarBase()), 'A never attempted entry is due');
    end;

    [Test]
    procedure FarRefusedEntryWaits()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "CGR Redelivery Far Spy";
        Redelivery: Codeunit "CGR Outbox Redelivery";
        EntryNo: Integer;
    begin
        HX147FarPrepare();
        EntryNo := Lib.QueueOutboxEntry('HX147-FW1');
        Spy.RefuseFarEntry(EntryNo);
        BindSubscription(Spy);

        Assert.AreEqual(0, Redelivery.RetryDue(HX147FarBase()), 'Refused entry not sent');
        Entry.Get(EntryNo);
        Assert.AreEqual(1, Entry.Attempts, 'One attempt');
        Assert.IsFalse(Redelivery.IsDue(EntryNo, HX147FarBase() + 10000), 'Not due after 10 seconds');
        Assert.IsTrue(Redelivery.IsDue(EntryNo, HX147FarBase() + 60000), 'Due after a minute');
    end;

    [Test]
    procedure FarFifthRefusalFails()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "CGR Redelivery Far Spy";
        Redelivery: Codeunit "CGR Outbox Redelivery";
        EntryNo: Integer;
        FarRound: Integer;
    begin
        HX147FarPrepare();
        EntryNo := Lib.QueueOutboxEntry('HX147-FL1');
        Spy.RefuseFarEntry(EntryNo);
        BindSubscription(Spy);

        for FarRound := 0 to 3 do
            Redelivery.RetryDue(HX147FarBase() + FarRound * 60000);
        Entry.Get(EntryNo);
        Assert.IsFalse(Entry.Failed, 'Not failed after four refusals');
        Redelivery.RetryDue(HX147FarBase() + 4 * 60000);
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Failed, 'Failed after five refusals');
    end;

    [Test]
    procedure FarCountsSentEntries()
    var
        Spy: Codeunit "CGR Redelivery Far Spy";
        Redelivery: Codeunit "CGR Outbox Redelivery";
        RefusedNo: Integer;
    begin
        HX147FarPrepare();
        Lib.QueueOutboxEntry('HX147-FC1');
        RefusedNo := Lib.QueueOutboxEntry('HX147-FC2');
        Spy.RefuseFarEntry(RefusedNo);
        BindSubscription(Spy);

        Assert.AreEqual(1, Redelivery.RetryDue(HX147FarBase()), 'Only the sent entry counts');
    end;

    local procedure HX147FarPrepare()
    var
        Entry: Record "CGR Outbox Entry";
    begin
        WorkDate(20240315D);
        Entry.DeleteAll();
        Commit();
    end;

    local procedure HX147FarBase(): DateTime
    begin
        exit(CreateDateTime(20240301D, 100000T));
    end;
}
