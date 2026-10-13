codeunit 86400 "HX047 Outbox Batch Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure SevenVehiclesThreeMessages()
    var
        Batcher: Codeunit "CGR Outbox Batcher";
        Entry: Record "CGR Outbox Entry";
    begin
        Prepare();

        Assert.AreEqual(3, Batcher.QueueVehicleBatch(VehicleNos(7)), 'Seven vehicles queue three messages');
        FindBatchEntries(Entry, 3);
        AssertMessageNos(Entry, 1, 3);
        Entry.Next();
        AssertMessageNos(Entry, 4, 6);
        Entry.Next();
        AssertMessageNos(Entry, 7, 7);
    end;

    [Test]
    procedure SixVehiclesTwoMessages()
    var
        Batcher: Codeunit "CGR Outbox Batcher";
        Entry: Record "CGR Outbox Entry";
    begin
        Prepare();

        Assert.AreEqual(2, Batcher.QueueVehicleBatch(VehicleNos(6)), 'Six vehicles queue two messages');
        FindBatchEntries(Entry, 2);
        AssertMessageNos(Entry, 1, 3);
        Entry.Next();
        AssertMessageNos(Entry, 4, 6);
    end;

    [Test]
    procedure ThreeVehiclesOneMessage()
    var
        Batcher: Codeunit "CGR Outbox Batcher";
        Entry: Record "CGR Outbox Entry";
    begin
        Prepare();

        Assert.AreEqual(1, Batcher.QueueVehicleBatch(VehicleNos(3)), 'Three vehicles queue one message');
        FindBatchEntries(Entry, 1);
        AssertMessageNos(Entry, 1, 3);
    end;

    [Test]
    procedure TwoVehiclesOneMessage()
    var
        Batcher: Codeunit "CGR Outbox Batcher";
        Entry: Record "CGR Outbox Entry";
    begin
        Prepare();

        Assert.AreEqual(1, Batcher.QueueVehicleBatch(VehicleNos(2)), 'Two vehicles queue one message');
        FindBatchEntries(Entry, 1);
        AssertMessageNos(Entry, 1, 2);
    end;

    [Test]
    procedure EmptyBatchQueuesNothing()
    var
        Batcher: Codeunit "CGR Outbox Batcher";
        Entry: Record "CGR Outbox Entry";
    begin
        Prepare();

        Assert.AreEqual(0, Batcher.QueueVehicleBatch(VehicleNos(0)), 'An empty batch queues no message');
        Assert.IsTrue(Entry.IsEmpty(), 'An empty batch leaves the outbox empty');
    end;

    [Test]
    procedure BatchEntriesPending()
    var
        Batcher: Codeunit "CGR Outbox Batcher";
        Entry: Record "CGR Outbox Entry";
    begin
        Prepare();

        Assert.AreEqual(2, Batcher.QueueVehicleBatch(VehicleNos(4)), 'Four vehicles queue two messages');
        FindBatchEntries(Entry, 2);
        repeat
            Assert.AreEqual('vehicleBatch', Entry."Event Type", 'Batch entry event type');
            Assert.AreEqual('vehicleBatch', PayloadEvent(Entry), 'Batch payload event');
            Assert.AreEqual('', Entry."Vehicle No.", 'A batch entry names no single vehicle');
            Assert.AreEqual(0DT, Entry."Last Attempt At", 'A queued batch entry has no attempt time');
            Assert.AreEqual('', Entry."Last Error", 'A queued batch entry has no error');
            Assert.IsFalse(Entry.Sent, 'A queued batch entry is not sent');
            Assert.AreEqual(0, Entry.Attempts, 'A queued batch entry has no attempts');
            Assert.IsFalse(Entry.Failed, 'A queued batch entry has not failed');
            Assert.AreNotEqual(0DT, Entry."Created At", 'A queued batch entry has its creation time');
        until Entry.Next() = 0;
    end;

    [Test]
    procedure TenVehiclesKeepOrder()
    var
        Batcher: Codeunit "CGR Outbox Batcher";
        Entry: Record "CGR Outbox Entry";
    begin
        Prepare();

        Assert.AreEqual(4, Batcher.QueueVehicleBatch(VehicleNos(10)), 'Ten vehicles queue four messages');
        FindBatchEntries(Entry, 4);
        AssertMessageNos(Entry, 1, 3);
        Entry.Next();
        AssertMessageNos(Entry, 4, 6);
        Entry.Next();
        AssertMessageNos(Entry, 7, 9);
        Entry.Next();
        AssertMessageNos(Entry, 10, 10);
    end;

    local procedure Prepare()
    var
        Setup: Record "CGR Setup";
        Entry: Record "CGR Outbox Entry";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Outbox Max Attempts" := 3;
        Setup.Modify();
        SessionContext.Reset();
        Entry.DeleteAll();
    end;

    local procedure VehicleNos(NoOfVehicles: Integer) Nos: List of [Code[20]]
    var
        i: Integer;
    begin
        for i := 1 to NoOfVehicles do
            Nos.Add(VehicleNo(i));
    end;

    local procedure VehicleNo(i: Integer): Code[20]
    begin
        exit(CopyStr('HX047-' + Format(i), 1, 20));
    end;

    local procedure FindBatchEntries(var Entry: Record "CGR Outbox Entry"; Expected: Integer)
    var
        AllEntries: Record "CGR Outbox Entry";
    begin
        Assert.AreEqual(Expected, AllEntries.Count(), 'Outbox entries queued by the batch');
        Entry.SetCurrentKey("Entry No.");
        Entry.SetRange("Event Type", 'vehicleBatch');
        Assert.AreEqual(Expected, Entry.Count(), 'vehicleBatch entries queued by the batch');
        Entry.FindSet();
    end;

    local procedure AssertMessageNos(Entry: Record "CGR Outbox Entry"; FromNo: Integer; ToNo: Integer)
    var
        Payload: JsonObject;
        Token: JsonToken;
        Nos: JsonArray;
        i: Integer;
    begin
        Assert.IsTrue(Payload.ReadFrom(Entry.Payload), 'The batch payload is JSON');
        Assert.IsTrue(Payload.Get('vehicleNos', Token), 'The batch payload lists vehicleNos');
        Nos := Token.AsArray();
        Assert.AreEqual(ToNo - FromNo + 1, Nos.Count(),
            StrSubstNo('Message %1 lists vehicles %2 to %3', Entry."Entry No.", FromNo, ToNo));
        for i := FromNo to ToNo do begin
            Nos.Get(i - FromNo, Token);
            Assert.AreEqual(Format(VehicleNo(i)), Token.AsValue().AsText(),
                StrSubstNo('Message %1 position %2', Entry."Entry No.", i - FromNo + 1));
        end;
    end;

    local procedure PayloadEvent(Entry: Record "CGR Outbox Entry"): Text
    var
        Payload: JsonObject;
        Token: JsonToken;
    begin
        Assert.IsTrue(Payload.ReadFrom(Entry.Payload), 'The batch payload is JSON');
        Assert.IsTrue(Payload.Get('event', Token), 'The batch payload names its event');
        exit(Token.AsValue().AsText());
    end;
}
