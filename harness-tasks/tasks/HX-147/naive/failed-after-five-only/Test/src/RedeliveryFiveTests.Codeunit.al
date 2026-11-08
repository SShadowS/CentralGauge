codeunit 80545 "CGR Redelivery Five Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure FiveBoundaryFromStoredAttempt()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "CGR Redelivery Five Spy";
        Redelivery: Codeunit "CGR Outbox Redelivery";
        EntryNo: Integer;
        Stamp: DateTime;
    begin
        HX147FivePrepare();
        EntryNo := Lib.QueueOutboxEntry('HX147-VB1');
        Spy.RefuseFiveEntry(EntryNo);
        BindSubscription(Spy);
        Redelivery.RetryDue(HX147FiveBase());

        Entry.Get(EntryNo);
        Stamp := Entry."Last Attempt At";
        Assert.AreNotEqual(0DT, Stamp, 'The refusal is recorded');
        Assert.IsTrue(Redelivery.IsDue(EntryNo, Stamp + 30000), 'Due at 30 seconds');
        Assert.IsFalse(Redelivery.IsDue(EntryNo, Stamp + 29000), 'Not due at 29 seconds');
    end;

    [Test]
    procedure FiveRefusalsFailTheEntry()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "CGR Redelivery Five Spy";
        Redelivery: Codeunit "CGR Outbox Redelivery";
        EntryNo: Integer;
        FiveRound: Integer;
    begin
        HX147FivePrepare();
        EntryNo := Lib.QueueOutboxEntry('HX147-VL1');
        Spy.RefuseFiveEntry(EntryNo);
        BindSubscription(Spy);

        for FiveRound := 0 to 4 do
            Redelivery.RetryDue(HX147FiveBase() + FiveRound * 60000);
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Failed, 'Failed after five refusals');

        Spy.RefuseFiveEntry(0);
        Assert.AreEqual(0, Redelivery.RetryDue(HX147FiveBase() + 5 * 60000), 'A failed entry is not sent');
    end;

    [Test]
    procedure FiveCountsSentEntries()
    var
        Spy: Codeunit "CGR Redelivery Five Spy";
        Redelivery: Codeunit "CGR Outbox Redelivery";
        RefusedNo: Integer;
    begin
        HX147FivePrepare();
        Lib.QueueOutboxEntry('HX147-VC1');
        RefusedNo := Lib.QueueOutboxEntry('HX147-VC2');
        Spy.RefuseFiveEntry(RefusedNo);
        BindSubscription(Spy);

        Assert.AreEqual(1, Redelivery.RetryDue(HX147FiveBase()), 'Only the sent entry counts');
    end;

    local procedure HX147FivePrepare()
    var
        Entry: Record "CGR Outbox Entry";
    begin
        WorkDate(20240315D);
        Entry.DeleteAll();
        Commit();
    end;

    local procedure HX147FiveBase(): DateTime
    begin
        exit(CreateDateTime(20240301D, 100000T));
    end;
}
