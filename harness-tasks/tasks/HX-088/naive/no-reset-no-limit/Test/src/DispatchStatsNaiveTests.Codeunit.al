codeunit 80144 "CGR Dispatch Stats Naive B"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure PendingDispatchIsCounted()
    var
        Entry: Record "CGR Outbox Entry";
        Subscribers: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        Stats: Codeunit "CGR Dispatch Statistics";
        AttemptsBefore: Integer;
        DeliveredBefore: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('HX088-N03');
        Lib.ClearOutbox('HX088-N04');
        Lib.QueueOutboxEntry('HX088-N03');
        Lib.QueueOutboxEntry('HX088-N04');
        Subscribers.RejectOutboxVehicle('HX088-N04');
        BindSubscription(Subscribers);
        AttemptsBefore := Stats.DispatchAttempts();
        DeliveredBefore := Stats.DispatchDelivered();

        Entry.SetFilter("Vehicle No.", '%1|%2', 'HX088-N03', 'HX088-N04');
        Assert.AreEqual(1, Dispatcher.DispatchPending(Entry), 'One of two entries delivered');
        Assert.AreEqual(AttemptsBefore + 2, Stats.DispatchAttempts(), 'Two attempts');
        Assert.AreEqual(DeliveredBefore + 1, Stats.DispatchDelivered(), 'One delivered');
    end;

    [Test]
    procedure DirectDispatchIsCounted()
    var
        Deliverer: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        StatsBefore: Codeunit "CGR Dispatch Statistics";
        StatsAfter: Codeunit "CGR Dispatch Statistics";
        EntryNo: Integer;
        AttemptsBefore: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('HX088-N05');
        EntryNo := Lib.QueueOutboxEntry('HX088-N05');
        BindSubscription(Deliverer);
        AttemptsBefore := StatsBefore.DispatchAttempts();

        Assert.IsTrue(Dispatcher.DispatchEntry(EntryNo), 'Delivered');
        Assert.AreEqual(AttemptsBefore + 1, StatsAfter.DispatchAttempts(), 'One attempt seen by another variable');
    end;

    [Test]
    procedure CountKeptAfterFailedTransaction()
    var
        Deliverer: Codeunit "CGR Test Library";
        Runner: Codeunit "CGR Dispatch Stats Runner";
        Stats: Codeunit "CGR Dispatch Statistics";
        EntryNo: Integer;
        AttemptsBefore: Integer;
        Ok: Boolean;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('HX088-N06');
        EntryNo := Lib.QueueOutboxEntry('HX088-N06');
        BindSubscription(Deliverer);
        AttemptsBefore := Stats.DispatchAttempts();
        Runner.SetEntryNo(EntryNo);

        Commit();
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'The later step fails');
        Assert.AreEqual(AttemptsBefore + 1, Stats.DispatchAttempts(), 'The attempt is kept');
    end;
}
