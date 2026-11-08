codeunit 80547 "CGR Redelivery Retried Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure RetriedRefusalMovesTheBoundary()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "CGR Redelivery Retried Spy";
        Redelivery: Codeunit "CGR Outbox Redelivery";
        EntryNo: Integer;
        Stamp: DateTime;
    begin
        HX147RetriedPrepare();
        EntryNo := HX147RetriedEntry();
        Spy.RefuseRetriedEntry(EntryNo);
        BindSubscription(Spy);

        Assert.AreEqual(0, Redelivery.RetryDue(HX147RetriedBase()), 'The refused entry is not sent');
        Entry.Get(EntryNo);
        Assert.AreEqual(2, Entry.Attempts, 'The refusal adds an attempt');
        Stamp := Entry."Last Attempt At";
        Assert.IsFalse(Redelivery.IsDue(EntryNo, HX147RetriedBase() + 10000), 'Not due 10 seconds after the refusal');
        Assert.IsTrue(Redelivery.IsDue(EntryNo, Stamp + 30000), 'Due at 30 seconds');
        Assert.IsFalse(Redelivery.IsDue(EntryNo, Stamp + 29000), 'Not due at 29 seconds');
    end;

    [Test]
    procedure RetriedFifthRefusalFails()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "CGR Redelivery Retried Spy";
        Redelivery: Codeunit "CGR Outbox Redelivery";
        EntryNo: Integer;
        RetriedRound: Integer;
    begin
        HX147RetriedPrepare();
        EntryNo := HX147RetriedEntry();
        Spy.RefuseRetriedEntry(EntryNo);
        BindSubscription(Spy);

        for RetriedRound := 0 to 2 do
            Redelivery.RetryDue(HX147RetriedBase() + RetriedRound * 60000);
        Entry.Get(EntryNo);
        Assert.AreEqual(4, Entry.Attempts, 'Four attempts');
        Assert.IsFalse(Entry.Failed, 'Not failed after four attempts');
        Redelivery.RetryDue(HX147RetriedBase() + 3 * 60000);
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Failed, 'Failed after the 5th attempt');
    end;

    [Test]
    procedure RetriedCountsSentEntries()
    var
        Spy: Codeunit "CGR Redelivery Retried Spy";
        Redelivery: Codeunit "CGR Outbox Redelivery";
        RefusedNo: Integer;
    begin
        HX147RetriedPrepare();
        HX147RetriedEntry();
        RefusedNo := HX147RetriedEntry();
        Spy.RefuseRetriedEntry(RefusedNo);
        BindSubscription(Spy);

        Assert.AreEqual(1, Redelivery.RetryDue(HX147RetriedBase()), 'Only the sent entry counts');
    end;

    local procedure HX147RetriedPrepare()
    var
        Entry: Record "CGR Outbox Entry";
    begin
        WorkDate(20240315D);
        Entry.DeleteAll();
        Commit();
    end;

    local procedure HX147RetriedBase(): DateTime
    begin
        exit(CreateDateTime(20240301D, 100000T));
    end;

    local procedure HX147RetriedEntry(): Integer
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.Init();
        Entry."Event Type" := 'HX147 retried';
        Entry."Vehicle No." := 'HX147-R1';
        Entry.Attempts := 1;
        Entry."Last Attempt At" := HX147RetriedBase() - 60000;
        Entry.Insert();
        exit(Entry."Entry No.");
    end;
}
