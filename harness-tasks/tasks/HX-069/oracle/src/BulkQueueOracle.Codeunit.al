codeunit 86840 "HX069 Bulk Queue Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure TwoVehiclesQueued()
    var
        Entry: Record "CGR Outbox Entry";
        VehicleNos: List of [Code[20]];
        Before: Integer;
        Queued: Integer;
    begin
        HX069Prepare();
        HX069ClearOutbox('HX069-1A');
        HX069ClearOutbox('HX069-1B');
        VehicleNos.Add('HX069-1A');
        VehicleNos.Add('HX069-1B');
        Before := Entry.Count();

        HX069AssertRun(VehicleNos, Queued);

        Assert.AreEqual(2, Queued, 'Two listed vehicles queue two messages');
        Assert.AreEqual(Before + 2, Entry.Count(), 'The outbox grows by the two messages');
        HX069AssertPending('HX069-1A');
        HX069AssertPending('HX069-1B');
    end;

    [Test]
    procedure ListOrderKept()
    var
        Entry: Record "CGR Outbox Entry";
        VehicleNos: List of [Code[20]];
        Before: Integer;
        Queued: Integer;
        EntryNoA: Integer;
        EntryNoB: Integer;
        EntryNoC: Integer;
    begin
        HX069Prepare();
        HX069ClearOutbox('HX069-2A');
        HX069ClearOutbox('HX069-2B');
        HX069ClearOutbox('HX069-2C');
        VehicleNos.Add('HX069-2C');
        VehicleNos.Add('HX069-2A');
        VehicleNos.Add('HX069-2B');
        Before := Entry.Count();

        HX069AssertRun(VehicleNos, Queued);

        Assert.AreEqual(3, Queued, 'Three listed vehicles queue three messages');
        Assert.AreEqual(Before + 3, Entry.Count(), 'The outbox grows by the three messages');
        EntryNoC := HX069EntryNo('HX069-2C', 1);
        EntryNoA := HX069EntryNo('HX069-2A', 1);
        EntryNoB := HX069EntryNo('HX069-2B', 1);
        Assert.IsTrue(EntryNoC < EntryNoA, 'HX069-2C is listed before HX069-2A and is queued first');
        Assert.IsTrue(EntryNoA < EntryNoB, 'HX069-2A is listed before HX069-2B and is queued first');
    end;

    [Test]
    procedure DuplicateQueuedOnce()
    var
        Entry: Record "CGR Outbox Entry";
        VehicleNos: List of [Code[20]];
        Before: Integer;
        Queued: Integer;
    begin
        HX069Prepare();
        HX069ClearOutbox('HX069-3A');
        HX069ClearOutbox('HX069-3B');
        VehicleNos.Add('HX069-3A');
        VehicleNos.Add('HX069-3B');
        VehicleNos.Add('HX069-3A');
        Before := Entry.Count();

        HX069AssertRun(VehicleNos, Queued);

        Assert.AreEqual(2, Queued, 'A vehicle listed twice is queued once');
        Assert.AreEqual(Before + 2, Entry.Count(), 'The outbox grows by the two messages');
        HX069EntryNo('HX069-3A', 1);
        HX069EntryNo('HX069-3B', 1);
    end;

    [Test]
    procedure BlankNumberSkipped()
    var
        Entry: Record "CGR Outbox Entry";
        BlankEntry: Record "CGR Outbox Entry";
        VehicleNos: List of [Code[20]];
        Before: Integer;
        BlankBefore: Integer;
        Queued: Integer;
    begin
        HX069Prepare();
        HX069ClearOutbox('HX069-4A');
        HX069ClearOutbox('HX069-4B');
        VehicleNos.Add('HX069-4A');
        VehicleNos.Add('');
        VehicleNos.Add('HX069-4B');
        Before := Entry.Count();
        BlankEntry.SetRange("Vehicle No.", '');
        BlankBefore := BlankEntry.Count();

        HX069AssertRun(VehicleNos, Queued);

        Assert.AreEqual(2, Queued, 'A blank number is not counted');
        Assert.AreEqual(Before + 2, Entry.Count(), 'The outbox grows by the two messages');
        HX069EntryNo('HX069-4A', 1);
        HX069EntryNo('HX069-4B', 1);
        Assert.AreEqual(BlankBefore, BlankEntry.Count(), 'A blank number in the list is not queued');
    end;

    [Test]
    procedure SingleVehicleAsToday()
    var
        Entry: Record "CGR Outbox Entry";
        VehicleNos: List of [Code[20]];
        Before: Integer;
        Queued: Integer;
    begin
        HX069Prepare();
        HX069ClearOutbox('HX069-5A');
        VehicleNos.Add('HX069-5A');
        Before := Entry.Count();

        HX069AssertRun(VehicleNos, Queued);

        Assert.AreEqual(1, Queued, 'One listed vehicle queues one message');
        Assert.AreEqual(Before + 1, Entry.Count(), 'The outbox grows by the one message');
        HX069EntryNo('HX069-5A', 1);
    end;

    [Test]
    procedure EmptyListQueuesNothing()
    var
        Entry: Record "CGR Outbox Entry";
        VehicleNos: List of [Code[20]];
        Before: Integer;
        Queued: Integer;
    begin
        HX069Prepare();
        Before := Entry.Count();

        HX069AssertRun(VehicleNos, Queued);

        Assert.AreEqual(0, Queued, 'An empty list queues nothing');
        Assert.AreEqual(Before, Entry.Count(), 'An empty list leaves the outbox as it was');
    end;

    [Test]
    procedure OlderMessageNoObstacle()
    var
        Entry: Record "CGR Outbox Entry";
        Facade: Codeunit "CGR Integration Facade";
        VehicleNos: List of [Code[20]];
        Before: Integer;
        Queued: Integer;
        OlderEntryNo: Integer;
    begin
        HX069Prepare();
        HX069ClearOutbox('HX069-7A');
        HX069ClearOutbox('HX069-7B');
        Facade.QueueVehicleCheckedOut('HX069-7A');
        OlderEntryNo := HX069EntryNo('HX069-7A', 1);
        Entry.Get(OlderEntryNo);
        Assert.IsFalse(Entry.Sent or Entry.Failed, 'Precondition: HX069-7A has an older pending message');
        Entry.Reset();
        VehicleNos.Add('HX069-7A');
        VehicleNos.Add('HX069-7B');
        Before := Entry.Count();

        HX069AssertRun(VehicleNos, Queued);

        Assert.AreEqual(2, Queued, 'A vehicle with an older message is queued again');
        Assert.AreEqual(Before + 2, Entry.Count(), 'The outbox grows by the two messages');
        Assert.IsTrue(HX069EntryNo('HX069-7A', 2) > OlderEntryNo, 'HX069-7A has its older and its new message');
        HX069EntryNo('HX069-7B', 1);
    end;

    [Test]
    procedure FourVehicles()
    var
        Entry: Record "CGR Outbox Entry";
        VehicleNos: List of [Code[20]];
        Before: Integer;
        Queued: Integer;
    begin
        HX069Prepare();
        HX069ClearOutbox('HX069-8A');
        HX069ClearOutbox('HX069-8B');
        HX069ClearOutbox('HX069-8C');
        HX069ClearOutbox('HX069-8D');
        VehicleNos.Add('HX069-8A');
        VehicleNos.Add('HX069-8B');
        VehicleNos.Add('HX069-8C');
        VehicleNos.Add('HX069-8D');
        Before := Entry.Count();

        HX069AssertRun(VehicleNos, Queued);

        Assert.AreEqual(4, Queued, 'Four listed vehicles queue four messages');
        Assert.AreEqual(Before + 4, Entry.Count(), 'The outbox grows by the four messages');
        HX069AssertPending('HX069-8A');
        HX069AssertPending('HX069-8B');
        HX069AssertPending('HX069-8C');
        HX069AssertPending('HX069-8D');
    end;

    local procedure HX069Prepare()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup."Outbox Max Attempts" := 3;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure HX069ClearOutbox(VehicleNo: Code[20])
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.DeleteAll();
    end;

    local procedure HX069AssertRun(VehicleNos: List of [Code[20]]; var Queued: Integer)
    var
        Runner: Codeunit "HX069 Queue Runner";
        Ok: Boolean;
    begin
        Runner.HX069SetVehicleNos(VehicleNos);
        Commit();
        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'QueueCheckedOutVehicles raised an error: ' + GetLastErrorText());
        Queued := Runner.HX069Queued();
    end;

    local procedure HX069EntryNo(VehicleNo: Code[20]; Expected: Integer): Integer
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetCurrentKey("Entry No.");
        Entry.SetRange("Vehicle No.", VehicleNo);
        Assert.AreEqual(Expected, Entry.Count(), StrSubstNo('Outbox messages for %1', VehicleNo));
        Entry.FindLast();
        exit(Entry."Entry No.");
    end;

    local procedure HX069AssertPending(VehicleNo: Code[20])
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.Get(HX069EntryNo(VehicleNo, 1));
        Assert.AreEqual('vehicleCheckedOut', Entry."Event Type", StrSubstNo('Event Type of %1', VehicleNo));
        Assert.AreEqual('{"event":"vehicleCheckedOut","vehicleNo":"' + VehicleNo + '"}', Entry.Payload,
            StrSubstNo('Payload of %1', VehicleNo));
        Assert.IsFalse(Entry.Sent, StrSubstNo('The message for %1 is not sent', VehicleNo));
        Assert.IsFalse(Entry.Failed, StrSubstNo('The message for %1 has not failed', VehicleNo));
        Assert.AreEqual(0, Entry.Attempts, StrSubstNo('The message for %1 has no attempts', VehicleNo));
        Assert.AreEqual(0DT, Entry."Last Attempt At", StrSubstNo('The message for %1 has no attempt time', VehicleNo));
        Assert.AreEqual('', Entry."Last Error", StrSubstNo('The message for %1 has no error', VehicleNo));
        Assert.AreNotEqual(0DT, Entry."Created At", StrSubstNo('The message for %1 has its creation time', VehicleNo));
    end;
}
