codeunit 80141 "CGR Dispatch Stats Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure DirectDispatchCountsOneAttempt()
    var
        Entry: Record "CGR Outbox Entry";
        Deliverer: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        Stats: Codeunit "CGR Dispatch Statistics";
        EntryNo: Integer;
        AttemptsBefore: Integer;
        DeliveredBefore: Integer;
        FailuresBefore: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('HX088-V01');
        EntryNo := Lib.QueueOutboxEntry('HX088-V01');
        BindSubscription(Deliverer);
        AttemptsBefore := Stats.DispatchAttempts();
        DeliveredBefore := Stats.DispatchDelivered();
        FailuresBefore := Stats.DispatchFailures();

        Assert.IsTrue(Dispatcher.DispatchEntry(EntryNo), 'The entry is delivered');
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Sent, 'The delivered entry is sent');
        Assert.AreEqual(AttemptsBefore + 1, Stats.DispatchAttempts(), 'A direct DispatchEntry counts one attempt');
        Assert.AreEqual(DeliveredBefore + 1, Stats.DispatchDelivered(), 'A direct DispatchEntry counts the delivery');
        Assert.AreEqual(FailuresBefore, Stats.DispatchFailures(), 'A delivery is no failure');
    end;

    [Test]
    procedure RejectionBelowLimitIsNoFailure()
    var
        Entry: Record "CGR Outbox Entry";
        Rejecter: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        Stats: Codeunit "CGR Dispatch Statistics";
        EntryNo: Integer;
        AttemptsBefore: Integer;
        DeliveredBefore: Integer;
        FailuresBefore: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('HX088-V02');
        EntryNo := Lib.QueueOutboxEntry('HX088-V02');
        Rejecter.RejectOutboxVehicle('HX088-V02');
        BindSubscription(Rejecter);
        AttemptsBefore := Stats.DispatchAttempts();
        DeliveredBefore := Stats.DispatchDelivered();
        FailuresBefore := Stats.DispatchFailures();

        Entry.SetRange("Vehicle No.", 'HX088-V02');
        Assert.AreEqual(0, Dispatcher.DispatchPending(Entry), 'The entry is rejected');
        Entry.Get(EntryNo);
        Assert.IsFalse(Entry.Sent, 'The rejected entry is not sent');
        Assert.IsFalse(Entry.Failed, 'One rejection is below the attempt limit');
        Assert.AreEqual(AttemptsBefore + 1, Stats.DispatchAttempts(), 'The rejection is an attempt');
        Assert.AreEqual(DeliveredBefore, Stats.DispatchDelivered(), 'A rejected attempt is not delivered');
        Assert.AreEqual(FailuresBefore, Stats.DispatchFailures(), 'A rejection below the limit is no failure');
    end;

    [Test]
    procedure FailureCountedAtAttemptLimit()
    var
        Entry: Record "CGR Outbox Entry";
        Rejecter: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        Stats: Codeunit "CGR Dispatch Statistics";
        EntryNo: Integer;
        AttemptsBefore: Integer;
        DeliveredBefore: Integer;
        FailuresBefore: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 2);
        Lib.ClearOutbox('HX088-V03');
        EntryNo := Lib.QueueOutboxEntry('HX088-V03');
        Rejecter.RejectOutboxVehicle('HX088-V03');
        BindSubscription(Rejecter);
        AttemptsBefore := Stats.DispatchAttempts();
        DeliveredBefore := Stats.DispatchDelivered();
        FailuresBefore := Stats.DispatchFailures();
        Entry.SetRange("Vehicle No.", 'HX088-V03');

        Dispatcher.DispatchPending(Entry);
        Entry.Get(EntryNo);
        Assert.IsFalse(Entry.Failed, 'Not failed after the first of two attempts');
        Assert.AreEqual(FailuresBefore, Stats.DispatchFailures(), 'No failure below the limit');

        Dispatcher.DispatchPending(Entry);
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Failed, 'Failed at the second of two attempts');
        Assert.AreEqual(FailuresBefore + 1, Stats.DispatchFailures(), 'The attempt that reached the limit is one failure');
        Assert.AreEqual(AttemptsBefore + 2, Stats.DispatchAttempts(), 'Two attempts');
        Assert.AreEqual(DeliveredBefore, Stats.DispatchDelivered(), 'Nothing delivered');
    end;

    [Test]
    procedure PendingDispatchCountsEachEntry()
    var
        Entry: Record "CGR Outbox Entry";
        Subscribers: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        Stats: Codeunit "CGR Dispatch Statistics";
        AttemptsBefore: Integer;
        DeliveredBefore: Integer;
        FailuresBefore: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('HX088-V04');
        Lib.ClearOutbox('HX088-V05');
        Lib.QueueOutboxEntry('HX088-V04');
        Lib.QueueOutboxEntry('HX088-V05');
        Subscribers.RejectOutboxVehicle('HX088-V05');
        BindSubscription(Subscribers);
        AttemptsBefore := Stats.DispatchAttempts();
        DeliveredBefore := Stats.DispatchDelivered();
        FailuresBefore := Stats.DispatchFailures();

        Entry.SetFilter("Vehicle No.", '%1|%2', 'HX088-V04', 'HX088-V05');
        Assert.AreEqual(1, Dispatcher.DispatchPending(Entry), 'One of two entries delivered');
        Assert.AreEqual(AttemptsBefore + 2, Stats.DispatchAttempts(), 'One attempt per dispatched entry');
        Assert.AreEqual(DeliveredBefore + 1, Stats.DispatchDelivered(), 'One delivered');
        Assert.AreEqual(FailuresBefore, Stats.DispatchFailures(), 'No entry reached the limit');
    end;

    [Test]
    procedure EveryVariableSharesTheStatistics()
    var
        Entry: Record "CGR Outbox Entry";
        Deliverer: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        StatsBefore: Codeunit "CGR Dispatch Statistics";
        StatsAfter: Codeunit "CGR Dispatch Statistics";
        AttemptsBefore: Integer;
        DeliveredBefore: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('HX088-V06');
        Lib.QueueOutboxEntry('HX088-V06');
        BindSubscription(Deliverer);
        AttemptsBefore := StatsBefore.DispatchAttempts();
        DeliveredBefore := StatsBefore.DispatchDelivered();

        Entry.SetRange("Vehicle No.", 'HX088-V06');
        Assert.AreEqual(1, Dispatcher.DispatchPending(Entry), 'The entry is delivered');
        Assert.AreEqual(AttemptsBefore + 1, StatsAfter.DispatchAttempts(), 'Another variable sees the attempt');
        Assert.AreEqual(DeliveredBefore + 1, StatsAfter.DispatchDelivered(), 'Another variable sees the delivery');
    end;

    [Test]
    procedure AttemptKeptWhenTransactionFailsLater()
    var
        Entry: Record "CGR Outbox Entry";
        Deliverer: Codeunit "CGR Test Library";
        Runner: Codeunit "CGR Dispatch Stats Runner";
        Stats: Codeunit "CGR Dispatch Statistics";
        EntryNo: Integer;
        AttemptsBefore: Integer;
        DeliveredBefore: Integer;
        FailuresBefore: Integer;
        Ok: Boolean;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('HX088-V07');
        EntryNo := Lib.QueueOutboxEntry('HX088-V07');
        BindSubscription(Deliverer);
        AttemptsBefore := Stats.DispatchAttempts();
        DeliveredBefore := Stats.DispatchDelivered();
        FailuresBefore := Stats.DispatchFailures();
        Runner.SetEntryNo(EntryNo);

        Commit();
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'The step after the dispatch fails');
        Assert.AreEqual('Later step failed.', GetLastErrorText(), 'It fails in the later step');
        Entry.Get(EntryNo);
        Assert.IsFalse(Entry.Sent, 'The failed transaction undid the delivery');
        Assert.AreEqual(AttemptsBefore + 1, Stats.DispatchAttempts(), 'The attempt is still counted');
        Assert.AreEqual(DeliveredBefore + 1, Stats.DispatchDelivered(), 'The delivery is still counted');
        Assert.AreEqual(FailuresBefore, Stats.DispatchFailures(), 'No failure');
    end;

    [Test]
    procedure ResetSetsEveryNumberToZero()
    var
        Entry: Record "CGR Outbox Entry";
        Subscribers: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        Stats: Codeunit "CGR Dispatch Statistics";
        RejectedNo: Integer;
        AttemptsBefore: Integer;
        DeliveredBefore: Integer;
        FailuresBefore: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 1);
        Lib.ClearOutbox('HX088-V08');
        Lib.ClearOutbox('HX088-V09');
        Lib.QueueOutboxEntry('HX088-V08');
        RejectedNo := Lib.QueueOutboxEntry('HX088-V09');
        Subscribers.RejectOutboxVehicle('HX088-V09');
        BindSubscription(Subscribers);
        AttemptsBefore := Stats.DispatchAttempts();
        DeliveredBefore := Stats.DispatchDelivered();
        FailuresBefore := Stats.DispatchFailures();

        Entry.SetFilter("Vehicle No.", '%1|%2', 'HX088-V08', 'HX088-V09');
        Assert.AreEqual(1, Dispatcher.DispatchPending(Entry), 'One of two entries delivered');
        Entry.Get(RejectedNo);
        Assert.IsTrue(Entry.Failed, 'With a limit of 1 the rejected entry fails at once');
        Assert.AreEqual(AttemptsBefore + 2, Stats.DispatchAttempts(), 'Two attempts before the reset');
        Assert.AreEqual(DeliveredBefore + 1, Stats.DispatchDelivered(), 'One delivery before the reset');
        Assert.AreEqual(FailuresBefore + 1, Stats.DispatchFailures(), 'One failure before the reset');

        Stats.ResetDispatchStatistics();
        Assert.AreEqual(0, Stats.DispatchAttempts(), 'Reset clears the attempts');
        Assert.AreEqual(0, Stats.DispatchDelivered(), 'Reset clears the deliveries');
        Assert.AreEqual(0, Stats.DispatchFailures(), 'Reset clears the failures');
    end;
}
