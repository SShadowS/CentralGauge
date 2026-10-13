codeunit 86100 "HX032 Transport Receipt Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure WritingTransportDelivers()
    var
        Entry: Record "CGR Outbox Entry";
        Transport: Codeunit "HX032 Receipt Transport";
        Runner: Codeunit "HX032 Dispatch Runner";
        EntryNo: Integer;
        Ok: Boolean;
    begin
        InitRun(3);
        EntryNo := QueueEntry('HX032-1A');
        Transport.ConfigureVehicle('HX032-1A', true, true, false);
        BindSubscription(Transport);

        Runner.SetEntry(EntryNo);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'DispatchEntry completes with a writing transport: ' + GetLastErrorText());
        Assert.IsTrue(Runner.EntryResult(), 'A delivered send returns true');
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Sent, 'The delivered entry is sent');
        Assert.AreEqual('', Entry."Last Error", 'No error on a delivered entry');
        Assert.AreEqual(1, Entry.Attempts, 'One attempt');
        Assert.IsTrue(MarkerExists(Transport, EntryNo), 'What the transport wrote during a successful send is kept');
    end;

    [Test]
    procedure FailedSendKeepsNoReceipt()
    var
        Entry: Record "CGR Outbox Entry";
        Transport: Codeunit "HX032 Receipt Transport";
        Runner: Codeunit "HX032 Dispatch Runner";
        EntryNo: Integer;
        Ok: Boolean;
    begin
        InitRun(3);
        EntryNo := QueueEntry('HX032-2A');
        Transport.ConfigureVehicle('HX032-2A', true, false, true);
        BindSubscription(Transport);

        Runner.SetEntry(EntryNo);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'A failing transport does not make DispatchEntry fail: ' + GetLastErrorText());
        Assert.IsFalse(Runner.EntryResult(), 'A failed send returns false');
        Assert.IsFalse(MarkerExists(Transport, EntryNo), 'Nothing the transport wrote during a failed send is kept');
        Entry.Get(EntryNo);
        Assert.IsFalse(Entry.Sent, 'The failed entry is not sent');
        Assert.IsFalse(Entry.Failed, 'One failure is below the attempt limit');
        Assert.AreEqual(1, Entry.Attempts, 'The attempt is counted');
        Assert.AreNotEqual(0DT, Entry."Last Attempt At", 'The attempt time is recorded');
        Assert.AreEqual(Transport.TransportDownText('HX032-2A'), Entry."Last Error", 'The transport''s error text is recorded');
    end;

    [Test]
    procedure UndeliveredSendKeepsNoReceipt()
    var
        Entry: Record "CGR Outbox Entry";
        Transport: Codeunit "HX032 Receipt Transport";
        Runner: Codeunit "HX032 Dispatch Runner";
        EntryNo: Integer;
        Ok: Boolean;
    begin
        InitRun(3);
        EntryNo := QueueEntry('HX032-3A');
        Transport.ConfigureVehicle('HX032-3A', true, false, false);
        BindSubscription(Transport);

        Runner.SetEntry(EntryNo);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'An undelivered send does not make DispatchEntry fail: ' + GetLastErrorText());
        Assert.IsFalse(Runner.EntryResult(), 'An undelivered send returns false');
        Assert.IsFalse(MarkerExists(Transport, EntryNo), 'Nothing the transport wrote during an undelivered send is kept');
        Entry.Get(EntryNo);
        Assert.IsFalse(Entry.Sent, 'The undelivered entry is not sent');
        Assert.AreEqual(1, Entry.Attempts, 'The attempt is counted');
        Assert.AreEqual(StrSubstNo('Outbox entry %1 was not delivered.', EntryNo), Entry."Last Error", 'Not-delivered text');
    end;

    [Test]
    procedure PendingDispatchMixedTransports()
    var
        Entry: Record "CGR Outbox Entry";
        Transport: Codeunit "HX032 Receipt Transport";
        Runner: Codeunit "HX032 Dispatch Runner";
        EntryA: Integer;
        EntryB: Integer;
        EntryC: Integer;
        Ok: Boolean;
    begin
        InitRun(3);
        EntryA := QueueEntry('HX032-4A');
        EntryB := QueueEntry('HX032-4B');
        EntryC := QueueEntry('HX032-4C');
        Transport.ConfigureVehicle('HX032-4A', true, true, false);
        Transport.ConfigureVehicle('HX032-4B', true, false, true);
        Transport.ConfigureVehicle('HX032-4C', false, true, false);
        BindSubscription(Transport);

        Runner.SetPending('HX032-4A|HX032-4B|HX032-4C');
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'DispatchPending completes with mixed transports: ' + GetLastErrorText());
        Assert.AreEqual(2, Runner.PendingResult(), 'Two of three entries delivered');
        Entry.Get(EntryA);
        Assert.IsTrue(Entry.Sent, 'Entry A is sent');
        Assert.IsTrue(MarkerExists(Transport, EntryA), 'Entry A''s receipt is kept');
        Entry.Get(EntryB);
        Assert.IsFalse(Entry.Sent, 'Entry B is not sent');
        Assert.IsFalse(MarkerExists(Transport, EntryB), 'Entry B''s receipt is not kept');
        Assert.AreEqual(Transport.TransportDownText('HX032-4B'), Entry."Last Error", 'Entry B keeps its transport''s error text');
        Entry.Get(EntryC);
        Assert.IsTrue(Entry.Sent, 'Entry C is sent');
        Assert.AreEqual('', Entry."Last Error", 'No error on entry C');
        Assert.IsFalse(MarkerExists(Transport, EntryC), 'Entry C''s transport wrote nothing');
    end;

    [Test]
    procedure WritingTransportFailsAtMaxAttempts()
    var
        Entry: Record "CGR Outbox Entry";
        Transport: Codeunit "HX032 Receipt Transport";
        Runner: Codeunit "HX032 Dispatch Runner";
        EntryNo: Integer;
        Ok: Boolean;
    begin
        InitRun(2);
        EntryNo := QueueEntry('HX032-5A');
        Transport.ConfigureVehicle('HX032-5A', true, false, true);
        BindSubscription(Transport);

        Runner.SetEntry(EntryNo);
        Commit();
        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'The first failed send does not make DispatchEntry fail: ' + GetLastErrorText());
        Assert.IsFalse(Runner.EntryResult(), 'The first send fails');

        Runner.SetEntry(EntryNo);
        Commit();
        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'The second failed send does not make DispatchEntry fail: ' + GetLastErrorText());
        Assert.IsFalse(Runner.EntryResult(), 'The second send fails');

        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Failed, 'Failed at the attempt limit');
        Assert.AreEqual(2, Entry.Attempts, 'Two attempts');
        Assert.IsFalse(Entry.Sent, 'The entry is not sent');
        Assert.AreEqual(Transport.TransportDownText('HX032-5A'), Entry."Last Error", 'The transport''s error text is recorded');
        Assert.IsFalse(MarkerExists(Transport, EntryNo), 'No receipt is kept from either failed send');
    end;

    [Test]
    procedure TransportGetsTheDispatchedEntry()
    var
        Transport: Codeunit "HX032 Receipt Transport";
        Runner: Codeunit "HX032 Dispatch Runner";
        OtherEntryNo: Integer;
        EntryNo: Integer;
        Ok: Boolean;
    begin
        InitRun(3);
        OtherEntryNo := QueueEntry('HX032-6B');
        EntryNo := QueueEntry('HX032-6A');
        Transport.ConfigureVehicle('HX032-6A', false, true, false);
        BindSubscription(Transport);

        Runner.SetEntry(EntryNo);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'DispatchEntry completes: ' + GetLastErrorText());
        Assert.AreNotEqual(OtherEntryNo, EntryNo, 'Two distinct entries');
        Assert.AreEqual(EntryNo, Transport.SeenEntry(), 'The transport gets the dispatched entry number');
        Assert.AreEqual('HX032-6A', Transport.SeenVehicle(), 'The transport gets the dispatched entry''s vehicle');
    end;

    [Test]
    procedure NonWritingTransportUnchanged()
    var
        Entry: Record "CGR Outbox Entry";
        Transport: Codeunit "HX032 Receipt Transport";
        Runner: Codeunit "HX032 Dispatch Runner";
        EntryNo: Integer;
        Ok: Boolean;
    begin
        InitRun(3);
        EntryNo := QueueEntry('HX032-7A');
        Transport.ConfigureVehicle('HX032-7A', false, true, false);
        BindSubscription(Transport);

        Runner.SetEntry(EntryNo);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'DispatchEntry completes: ' + GetLastErrorText());
        Assert.IsTrue(Runner.EntryResult(), 'A delivered send returns true');
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Sent, 'The delivered entry is sent');
        Assert.AreEqual('', Entry."Last Error", 'No error');
        Assert.AreEqual(1, Entry.Attempts, 'One attempt');
    end;

    local procedure InitRun(MaxAttempts: Integer)
    var
        Setup: Record "CGR Setup";
        Vehicle: Record "CGR Vehicle";
        Entry: Record "CGR Outbox Entry";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup."Outbox Max Attempts" := MaxAttempts;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
        Vehicle.SetFilter("No.", 'HX032-M*');
        Vehicle.DeleteAll();
        Entry.SetFilter("Vehicle No.", 'HX032-*');
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

    local procedure MarkerExists(var Transport: Codeunit "HX032 Receipt Transport"; EntryNo: Integer): Boolean
    var
        Vehicle: Record "CGR Vehicle";
    begin
        exit(Vehicle.Get(Transport.MarkerNo(EntryNo)));
    end;
}
