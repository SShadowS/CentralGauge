codeunit 80540 "CGR Outbox Redelivery Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure NeverAttemptedEntryIsDue()
    var
        Runner: Codeunit "CGR Redelivery Runner";
        EntryNo: Integer;
        Ok: Boolean;
    begin
        HX147Prepare();
        EntryNo := Lib.QueueOutboxEntry('HX147-N1');
        Runner.SetDueCheck(EntryNo, HX147Base());

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'IsDue answers for a never attempted entry: ' + GetLastErrorText());
        Assert.IsTrue(Runner.DueInRedeliveryRun(), 'A never attempted entry is due');
    end;

    [Test]
    procedure DueExactlyThirtySecondsAfterRefusal()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "CGR Redelivery Refusal Spy";
        Redelivery: Codeunit "CGR Outbox Redelivery";
        EntryNo: Integer;
        Stamp: DateTime;
    begin
        HX147Prepare();
        EntryNo := Lib.QueueOutboxEntry('HX147-B1');
        Spy.RefuseRedeliveryOf(EntryNo);
        BindSubscription(Spy);
        Redelivery.RetryDue(HX147Base());

        Entry.Get(EntryNo);
        Stamp := Entry."Last Attempt At";
        Assert.AreNotEqual(0DT, Stamp, 'A refused entry records its attempt');
        Assert.IsTrue(Redelivery.IsDue(EntryNo, Stamp + 30000), 'Due exactly 30 seconds after the last attempt');
        Assert.IsFalse(Redelivery.IsDue(EntryNo, Stamp + 29000), 'Not due 29 seconds after the last attempt');
    end;

    [Test]
    procedure RefusalWaitsBeforeNextTry()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "CGR Redelivery Refusal Spy";
        Redelivery: Codeunit "CGR Outbox Redelivery";
        EntryNo: Integer;
    begin
        HX147Prepare();
        EntryNo := Lib.QueueOutboxEntry('HX147-W1');
        Spy.RefuseRedeliveryOf(EntryNo);
        BindSubscription(Spy);

        Assert.AreEqual(0, Redelivery.RetryDue(HX147Base()), 'A refused entry is not sent');
        Entry.Get(EntryNo);
        Assert.AreEqual(1, Entry.Attempts, 'A refusal adds one attempt');
        Assert.IsFalse(Entry.Sent, 'A refused entry is not sent');
        Assert.IsFalse(Entry.Failed, 'One refusal does not fail the entry');
        Assert.IsFalse(Redelivery.IsDue(EntryNo, HX147Base() + 10000), 'Not due 10 seconds after the refusal');

        Assert.AreEqual(0, Redelivery.RetryDue(HX147Base() + 10000), 'Nothing is sent 10 seconds later');
        Entry.Get(EntryNo);
        Assert.AreEqual(1, Entry.Attempts, 'An entry that is not due is not attempted again');
    end;

    [Test]
    procedure FifthRefusalFailsTheEntry()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "CGR Redelivery Refusal Spy";
        Redelivery: Codeunit "CGR Outbox Redelivery";
        EntryNo: Integer;
        RetryRound: Integer;
    begin
        HX147Prepare();
        EntryNo := Lib.QueueOutboxEntry('HX147-L1');
        Spy.RefuseRedeliveryOf(EntryNo);
        BindSubscription(Spy);

        for RetryRound := 0 to 3 do
            Redelivery.RetryDue(HX147Base() + RetryRound * 60000);
        Entry.Get(EntryNo);
        Assert.AreEqual(4, Entry.Attempts, 'Four refused attempts');
        Assert.IsFalse(Entry.Failed, 'The entry is not failed after its 4th refused attempt');

        Redelivery.RetryDue(HX147Base() + 4 * 60000);
        Entry.Get(EntryNo);
        Assert.AreEqual(5, Entry.Attempts, 'Five refused attempts');
        Assert.IsTrue(Entry.Failed, 'The entry is failed after its 5th refused attempt');

        Spy.RefuseRedeliveryOf(0);
        Assert.AreEqual(0, Redelivery.RetryDue(HX147Base() + 5 * 60000), 'A failed entry is not sent again');
        Entry.Get(EntryNo);
        Assert.IsFalse(Entry.Sent, 'A failed entry stays unsent');
    end;

    [Test]
    procedure ResultCountsOnlySentEntries()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "CGR Redelivery Refusal Spy";
        Redelivery: Codeunit "CGR Outbox Redelivery";
        GoodNo: Integer;
        RefusedNo: Integer;
    begin
        HX147Prepare();
        GoodNo := Lib.QueueOutboxEntry('HX147-C1');
        RefusedNo := Lib.QueueOutboxEntry('HX147-C2');
        Spy.RefuseRedeliveryOf(RefusedNo);
        BindSubscription(Spy);

        Assert.AreEqual(1, Redelivery.RetryDue(HX147Base()), 'The result is the number of entries sent');
        Entry.Get(GoodNo);
        Assert.IsTrue(Entry.Sent, 'The accepted entry is sent');
        Entry.Get(RefusedNo);
        Assert.IsFalse(Entry.Sent, 'The refused entry is not sent');
    end;

    [Test]
    procedure RefusedEntryDoesNotStopOthers()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "CGR Redelivery Refusal Spy";
        Runner: Codeunit "CGR Redelivery Runner";
        RefusedNo: Integer;
        SecondNo: Integer;
        ThirdNo: Integer;
        Ok: Boolean;
    begin
        HX147Prepare();
        RefusedNo := Lib.QueueOutboxEntry('HX147-S1');
        SecondNo := Lib.QueueOutboxEntry('HX147-S2');
        ThirdNo := Lib.QueueOutboxEntry('HX147-S3');
        Spy.RefuseRedeliveryOf(RefusedNo);
        BindSubscription(Spy);
        Runner.SetRetryRun(HX147Base());

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'A refused entry does not stop the job: ' + GetLastErrorText());
        Assert.AreEqual(2, Runner.SentInRedeliveryRun(), 'Both other entries are sent');
        Entry.Get(SecondNo);
        Assert.IsTrue(Entry.Sent, 'The entry after the refused one is sent');
        Entry.Get(ThirdNo);
        Assert.IsTrue(Entry.Sent, 'The last entry is sent');
        Entry.Get(RefusedNo);
        Assert.IsFalse(Entry.Sent, 'The refused entry is not sent');
        Assert.AreEqual(1, Entry.Attempts, 'The refused entry has one attempt');
    end;

    local procedure HX147Prepare()
    var
        Entry: Record "CGR Outbox Entry";
    begin
        WorkDate(20240315D);
        Entry.DeleteAll();
        Commit();
    end;

    local procedure HX147Base(): DateTime
    begin
        exit(CreateDateTime(20240301D, 100000T));
    end;
}
