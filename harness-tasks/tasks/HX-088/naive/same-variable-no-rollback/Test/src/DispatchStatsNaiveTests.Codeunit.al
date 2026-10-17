codeunit 80143 "CGR Dispatch Stats Naive A"
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
        Lib.ClearOutbox('HX088-N01');
        Lib.ClearOutbox('HX088-N02');
        Lib.QueueOutboxEntry('HX088-N01');
        Lib.QueueOutboxEntry('HX088-N02');
        Subscribers.RejectOutboxVehicle('HX088-N02');
        BindSubscription(Subscribers);
        AttemptsBefore := Stats.DispatchAttempts();
        DeliveredBefore := Stats.DispatchDelivered();

        Entry.SetFilter("Vehicle No.", '%1|%2', 'HX088-N01', 'HX088-N02');
        Assert.AreEqual(1, Dispatcher.DispatchPending(Entry), 'One of two entries delivered');
        Assert.AreEqual(AttemptsBefore + 2, Stats.DispatchAttempts(), 'Two attempts');
        Assert.AreEqual(DeliveredBefore + 1, Stats.DispatchDelivered(), 'One delivered');
    end;
}
