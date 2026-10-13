codeunit 86440 "HX049 Transport Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure EventTransportByDefault()
    var
        Entry: Record "CGR Outbox Entry";
        Endpoint: Codeunit "HX049 Endpoint";
        Spy: Codeunit "HX049 Transport Spy";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        InitRun(Enum::"CGR Outbox Transport"::"Event");
        EntryNo := QueueEntry('HX049-1');
        BindSubscription(Endpoint);

        Assert.IsTrue(Dispatcher.DispatchEntry(EntryNo), 'The Event transport delivers through OnSendEntry');
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Sent, 'The delivered entry is sent');
        Assert.AreEqual('', Entry."Last Error", 'No error on a delivered entry');
        Assert.AreEqual(1, Entry.Attempts, 'One attempt');
        Assert.AreEqual(0, Spy.Calls(), 'The partner transport is not used for Event');
    end;

    [Test]
    procedure PartnerTransportUsed()
    var
        Entry: Record "CGR Outbox Entry";
        Endpoint: Codeunit "HX049 Endpoint";
        Spy: Codeunit "HX049 Transport Spy";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        InitRun(Enum::"CGR Outbox Transport"::"HX049 Partner");
        EntryNo := QueueEntry('HX049-2');
        Spy.SetMode(Spy.DeliverMode());
        Endpoint.RejectVehicle('HX049-2');
        BindSubscription(Endpoint);

        Assert.IsTrue(Dispatcher.DispatchEntry(EntryNo), 'The chosen partner transport delivers');
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Sent, 'The entry delivered by the partner transport is sent');
        Assert.AreEqual('', Entry."Last Error", 'No error on a delivered entry');
        Assert.AreEqual(1, Spy.Calls(), 'The partner transport is asked once');
        Assert.AreEqual(EntryNo, Spy.LastEntry(), 'The partner transport gets the dispatched entry');
    end;

    [Test]
    procedure PartnerRefusalNotDelivered()
    var
        Entry: Record "CGR Outbox Entry";
        Endpoint: Codeunit "HX049 Endpoint";
        Spy: Codeunit "HX049 Transport Spy";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        InitRun(Enum::"CGR Outbox Transport"::"HX049 Partner");
        EntryNo := QueueEntry('HX049-3');
        Spy.SetMode(Spy.RefuseMode());
        BindSubscription(Endpoint);

        Assert.IsFalse(Dispatcher.DispatchEntry(EntryNo), 'A refusing partner transport does not deliver');
        Entry.Get(EntryNo);
        Assert.IsFalse(Entry.Sent, 'The refused entry is not sent');
        Assert.IsFalse(Entry.Failed, 'One refusal is below the attempt limit');
        Assert.AreEqual(1, Entry.Attempts, 'The attempt is counted');
        Assert.AreEqual(StrSubstNo('Outbox entry %1 was not delivered.', EntryNo), Entry."Last Error", 'Not-delivered text');
        Assert.AreEqual(1, Spy.Calls(), 'The partner transport is asked once');
    end;

    [Test]
    procedure PartnerErrorKeptAsLastError()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "HX049 Transport Spy";
        Runner: Codeunit "HX049 Dispatch Runner";
        EntryNo: Integer;
        Ok: Boolean;
    begin
        InitRun(Enum::"CGR Outbox Transport"::"HX049 Partner");
        EntryNo := QueueEntry('HX049-4');
        Spy.SetMode(Spy.ErrorMode());

        Runner.SetEntry(EntryNo);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'A failing partner transport does not make DispatchEntry fail: ' + GetLastErrorText());
        Assert.IsFalse(Runner.EntryResult(), 'A failing transport does not deliver');
        Entry.Get(EntryNo);
        Assert.IsFalse(Entry.Sent, 'The failed entry is not sent');
        Assert.AreEqual(1, Entry.Attempts, 'The attempt is counted');
        Assert.AreEqual('HX049 partner down', Entry."Last Error", 'The transport''s error text is recorded');
        Assert.AreEqual(1, Spy.Calls(), 'The partner transport is asked once');
    end;

    [Test]
    procedure BareValueUsesEventTransport()
    var
        Entry: Record "CGR Outbox Entry";
        Endpoint: Codeunit "HX049 Endpoint";
        Spy: Codeunit "HX049 Transport Spy";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        InitRun(Enum::"CGR Outbox Transport"::"HX049 Bare");
        EntryNo := QueueEntry('HX049-5');
        BindSubscription(Endpoint);

        Assert.IsTrue(Dispatcher.DispatchEntry(EntryNo), 'A value without its own transport sends through the Event transport');
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Sent, 'The delivered entry is sent');
        Assert.AreEqual('', Entry."Last Error", 'No error on a delivered entry');
        Assert.AreEqual(0, Spy.Calls(), 'The partner transport is not used for a value without a transport');
    end;

    [Test]
    procedure EventRejectionKeptAsToday()
    var
        Entry: Record "CGR Outbox Entry";
        Endpoint: Codeunit "HX049 Endpoint";
        Runner: Codeunit "HX049 Dispatch Runner";
        EntryNo: Integer;
        Ok: Boolean;
    begin
        InitRun(Enum::"CGR Outbox Transport"::"Event");
        EntryNo := QueueEntry('HX049-6');
        Endpoint.RejectVehicle('HX049-6');
        BindSubscription(Endpoint);

        Runner.SetEntry(EntryNo);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'A rejecting subscriber does not make DispatchEntry fail: ' + GetLastErrorText());
        Assert.IsFalse(Runner.EntryResult(), 'A rejected entry is not delivered');
        Entry.Get(EntryNo);
        Assert.IsFalse(Entry.Sent, 'The rejected entry is not sent');
        Assert.AreEqual(1, Entry.Attempts, 'The attempt is counted');
        Assert.AreEqual('Endpoint rejected vehicle HX049-6.', Entry."Last Error", 'The subscriber''s rejection text is recorded');
    end;

    [Test]
    procedure PendingThroughPartner()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "HX049 Transport Spy";
        Runner: Codeunit "HX049 Dispatch Runner";
        EntryA: Integer;
        EntryB: Integer;
        SentNo: Integer;
        FailedNo: Integer;
        Ok: Boolean;
    begin
        InitRun(Enum::"CGR Outbox Transport"::"HX049 Partner");
        EntryA := QueueEntry('HX049-7A');
        EntryB := QueueEntry('HX049-7B');
        SentNo := QueueEntry('HX049-7C');
        FailedNo := QueueEntry('HX049-7D');
        Entry.Get(SentNo);
        Entry.Sent := true;
        Entry.Modify();
        Entry.Get(FailedNo);
        Entry.Failed := true;
        Entry.Attempts := 3;
        Entry.Modify();
        Spy.SetMode(Spy.DeliverMode());

        Runner.SetPending('HX049-7A|HX049-7B|HX049-7C|HX049-7D');
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'DispatchPending completes through the partner transport: ' + GetLastErrorText());
        Assert.AreEqual(2, Runner.PendingResult(), 'Both pending entries delivered');
        Entry.Get(EntryA);
        Assert.IsTrue(Entry.Sent, 'Entry A is sent');
        Entry.Get(EntryB);
        Assert.IsTrue(Entry.Sent, 'Entry B is sent');
        Assert.AreEqual(2, Spy.Calls(), 'The partner transport is asked once per pending entry only');
        Entry.Get(SentNo);
        Assert.AreEqual(0, Entry.Attempts, 'A sent entry is not dispatched again');
        Entry.Get(FailedNo);
        Assert.AreEqual(3, Entry.Attempts, 'A failed entry is not dispatched');
        Assert.IsFalse(Entry.Sent, 'A failed entry stays unsent');
    end;

    [Test]
    procedure EventTransportSendsThroughEvent()
    var
        Entry: Record "CGR Outbox Entry";
        Endpoint: Codeunit "HX049 Endpoint";
        Spy: Codeunit "HX049 Transport Spy";
        EventTransport: Codeunit "CGR Event Transport";
        Transport: Interface "CGR Outbox Transport";
        EntryNo: Integer;
    begin
        InitRun(Enum::"CGR Outbox Transport"::"HX049 Partner");
        EntryNo := QueueEntry('HX049-8');
        Spy.SetMode(Spy.RefuseMode());
        BindSubscription(Endpoint);
        Entry.Get(EntryNo);

        Assert.IsTrue(EventTransport.Send(Entry), 'The Event transport delivers when an OnSendEntry subscriber delivers');
        Transport := Enum::"CGR Outbox Transport"::"Event";
        Assert.IsTrue(Transport.Send(Entry), 'The Event value is implemented by the Event transport');
        Assert.AreEqual(0, Spy.Calls(), 'The Event transport does not use the chosen setup transport');
        Entry.Get(EntryNo);
        Assert.AreEqual(0, Entry.Attempts, 'Send itself counts no attempt');
        Assert.IsFalse(Entry.Sent, 'Send itself does not mark the entry sent');
    end;

    [Test]
    procedure EventTransportWithoutSubscriberNotDelivered()
    var
        Entry: Record "CGR Outbox Entry";
        Setup: Record "CGR Setup";
        AllObj: Record AllObj;
        EventTransport: Codeunit "CGR Event Transport";
        EntryNo: Integer;
    begin
        InitRun(Enum::"CGR Outbox Transport"::"Event");
        EntryNo := QueueEntry('HX049-9');
        Entry.Get(EntryNo);

        Assert.IsFalse(EventTransport.Send(Entry), 'Without a delivering OnSendEntry subscriber the Event transport does not deliver');
        Setup.Init();
        Assert.AreEqual(Enum::"CGR Outbox Transport"::"Event", Setup."Outbox Transport", 'Event is the default transport');
        Assert.AreEqual(0, Enum::"CGR Outbox Transport"::"Event".AsInteger(), 'Event is value 0');
        Assert.IsTrue(AllObj.Get(AllObj."Object Type"::Enum, 70415), 'The transport enum has ID 70415');
        Assert.AreEqual('CGR Outbox Transport', AllObj."Object Name", 'Enum 70415 is CGR Outbox Transport');
        Assert.IsTrue(AllObj.Get(AllObj."Object Type"::Codeunit, 70416), 'The Event transport has ID 70416');
        Assert.AreEqual('CGR Event Transport', AllObj."Object Name", 'Codeunit 70416 is CGR Event Transport');
    end;

    [Test]
    procedure PartnerRefusalFailsAtMaxAttempts()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "HX049 Transport Spy";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        InitRunMax(Enum::"CGR Outbox Transport"::"HX049 Partner", 2);
        EntryNo := QueueEntry('HX049-10');
        Spy.SetMode(Spy.RefuseMode());
        Entry.SetRange("Vehicle No.", 'HX049-10');

        Assert.AreEqual(0, Dispatcher.DispatchPending(Entry), 'First attempt refused');
        Entry.Get(EntryNo);
        Assert.IsFalse(Entry.Failed, 'Not failed after the first attempt');
        Assert.AreEqual(0, Dispatcher.DispatchPending(Entry), 'Second attempt refused');
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Failed, 'Failed at the attempt limit');
        Assert.AreEqual(2, Entry.Attempts, 'Two attempts');
        Assert.AreEqual(0, Dispatcher.DispatchPending(Entry), 'A failed entry is not dispatched');
        Assert.AreEqual(2, Spy.Calls(), 'The partner transport is not asked for a failed entry');

        Dispatcher.Requeue(EntryNo);
        Spy.SetMode(Spy.DeliverMode());
        Assert.AreEqual(1, Dispatcher.DispatchPending(Entry), 'A requeued entry is dispatched through the partner transport');
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Sent, 'The requeued entry is sent');
        Assert.AreEqual(1, Entry.Attempts, 'Requeue reset the attempts');
        Assert.AreEqual(3, Spy.Calls(), 'The partner transport delivered the requeued entry');
    end;

    local procedure InitRun(Transport: Enum "CGR Outbox Transport")
    begin
        InitRunMax(Transport, 3);
    end;

    local procedure InitRunMax(Transport: Enum "CGR Outbox Transport"; MaxAttempts: Integer)
    var
        Setup: Record "CGR Setup";
        Entry: Record "CGR Outbox Entry";
        SessionContext: Codeunit "CGR Session Context";
        Spy: Codeunit "HX049 Transport Spy";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup."Outbox Max Attempts" := MaxAttempts;
        Setup."Suspend Rentals" := false;
        Setup."Outbox Transport" := Transport;
        Setup.Modify();
        SessionContext.Reset();
        Spy.Reset();
        Entry.SetFilter("Vehicle No.", 'HX049-*');
        Entry.DeleteAll();
    end;

    local procedure QueueEntry(VehicleNo: Code[20]): Integer
    var
        Entry: Record "CGR Outbox Entry";
        Facade: Codeunit "CGR Integration Facade";
    begin
        Facade.QueueVehicleCheckedOut(VehicleNo);
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.FindLast();
        exit(Entry."Entry No.");
    end;
}
