codeunit 86580 "HX056 Correlation Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure QueuedEntryCarriesNumber()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "HX056 Queue Spy";
        Payload: JsonObject;
        Token: JsonToken;
        EntryNo: Integer;
    begin
        InitProcedure();
        ClearOutbox('HX056-1A');
        BindSubscription(Spy);

        EntryNo := QueueEntry('HX056-1A');

        Entry.Get(EntryNo);
        Assert.IsTrue(Entry."Correlation No." > 0, 'The queued entry carries a positive correlation number');
        Assert.AreEqual(
            '{"event":"vehicleCheckedOut","vehicleNo":"HX056-1A","correlationNo":' + Format(Entry."Correlation No.", 0, 9) + '}',
            Entry.Payload, 'The payload carries the correlation number as a JSON number');
        Assert.IsTrue(Payload.ReadFrom(Entry.Payload), 'The payload is JSON');
        Assert.IsTrue(Payload.Get('correlationNo', Token), 'The payload has correlationNo');
        Assert.AreEqual(Entry."Correlation No.", Token.AsValue().AsBigInteger(), 'The payload number equals the field');
        Assert.AreEqual(1, Spy.Calls(), 'OnAfterQueueEntry is raised once');
        Assert.AreEqual(Entry."Correlation No.", Spy.NumberAt(1), 'The event carries the entry''s number');
        Assert.AreEqual(EntryNo, Spy.EntryNoAt(1), 'The event carries the stored entry');
        Assert.IsTrue(Spy.StoredAt(1), 'The entry is stored with its number when the event is raised');
        Assert.AreEqual(Entry."Correlation No.", Spy.PayloadNumberAt(1), 'The event''s entry has the number in its payload');
    end;

    [Test]
    procedure NumbersIncreaseInQueueOrder()
    var
        Entry: Record "CGR Outbox Entry";
        NumberA: BigInteger;
        NumberB: BigInteger;
        NumberC: BigInteger;
    begin
        InitProcedure();
        ClearOutbox('HX056-2A');
        ClearOutbox('HX056-2B');
        ClearOutbox('HX056-2C');

        Entry.Get(QueueEntry('HX056-2A'));
        NumberA := Entry."Correlation No.";
        Entry.Get(QueueEntry('HX056-2B'));
        NumberB := Entry."Correlation No.";
        Entry.Get(QueueEntry('HX056-2C'));
        NumberC := Entry."Correlation No.";

        Assert.IsTrue(NumberA > 0, 'The first number is positive');
        Assert.IsTrue(NumberB > NumberA, 'The second entry has a higher number than the first');
        Assert.IsTrue(NumberC > NumberB, 'The third entry has a higher number than the second');
    end;

    [Test]
    procedure FailedQueueNumberNotReissued()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "HX056 Queue Spy";
        Runner: Codeunit "HX056 Queue Runner";
        ErrorText: Text;
        FailedNumber: BigInteger;
        Ok: Boolean;
    begin
        InitProcedure();
        ClearOutbox('HX056-3F');
        ClearOutbox('HX056-3G');
        Spy.Refuse('HX056-3F');
        BindSubscription(Spy);
        Runner.Configure('HX056-3F', false);

        Commit();
        Ok := Runner.Run();
        ErrorText := GetLastErrorText();

        Assert.IsFalse(Ok, 'The refused queueing fails');
        Assert.AreEqual('HX056 partner refused HX056-3F.', ErrorText, 'The run fails with the partner''s error');
        Assert.AreEqual(1, Spy.Calls(), 'The partner saw the failed entry');
        FailedNumber := Spy.NumberAt(1);
        Assert.IsTrue(FailedNumber > 0, 'The partner saw a positive number');
        Entry.SetRange("Vehicle No.", 'HX056-3F');
        Assert.IsTrue(Entry.IsEmpty(), 'The failed entry is not kept');
        Entry.Reset();
        Entry.Get(QueueEntry('HX056-3G'));
        Assert.IsTrue(Entry."Correlation No." > FailedNumber, 'The number the partner saw is not handed out again');
    end;

    [Test]
    procedure FailedQueueKeepsNothingOfCaller()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "HX056 Queue Spy";
        Runner: Codeunit "HX056 Queue Runner";
        ErrorText: Text;
        Ok: Boolean;
    begin
        InitProcedure();
        ClearOutbox('HX056-4F');
        ClearOutbox('HX056-MARK');
        Spy.Refuse('HX056-4F');
        BindSubscription(Spy);
        Runner.Configure('HX056-4F', true);

        Commit();
        Ok := Runner.Run();
        ErrorText := GetLastErrorText();

        Assert.IsFalse(Ok, 'The refused queueing fails');
        Assert.AreEqual('HX056 partner refused HX056-4F.', ErrorText, 'The run fails with the partner''s error');
        Assert.AreEqual(1, Spy.Calls(), 'The partner saw the entry before refusing it');
        Entry.SetRange("Vehicle No.", 'HX056-MARK');
        Assert.IsTrue(Entry.IsEmpty(), 'The caller''s own entry written before queueing is not kept');
        Entry.SetRange("Vehicle No.", 'HX056-4F');
        Assert.IsTrue(Entry.IsEmpty(), 'The queued entry is not kept');
    end;

    [Test]
    procedure TwoFailuresThenSuccess()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "HX056 Queue Spy";
        Runner: Codeunit "HX056 Queue Runner";
        Ok1: Boolean;
        Ok2: Boolean;
    begin
        InitProcedure();
        ClearOutbox('HX056-5F1');
        ClearOutbox('HX056-5F2');
        ClearOutbox('HX056-5G');
        Spy.Refuse('HX056-5F1');
        Spy.Refuse('HX056-5F2');
        BindSubscription(Spy);

        Runner.Configure('HX056-5F1', false);
        Commit();
        Ok1 := Runner.Run();
        Runner.Configure('HX056-5F2', false);
        Commit();
        Ok2 := Runner.Run();

        Assert.IsFalse(Ok1, 'The first refused queueing fails');
        Assert.IsFalse(Ok2, 'The second refused queueing fails');
        Assert.AreEqual(2, Spy.Calls(), 'The partner saw both failed entries');
        Assert.IsTrue(Spy.NumberAt(1) > 0, 'The first failed entry had a positive number');
        Assert.IsTrue(Spy.NumberAt(2) > Spy.NumberAt(1), 'The second failed entry got a new, higher number');
        Entry.SetFilter("Vehicle No.", '%1|%2', 'HX056-5F1', 'HX056-5F2');
        Assert.IsTrue(Entry.IsEmpty(), 'The failed entries are not kept');
        Entry.Reset();
        Entry.Get(QueueEntry('HX056-5G'));
        Assert.IsTrue(Entry."Correlation No." > Spy.NumberAt(2), 'The next entry gets a number above both failed ones');
    end;

    [Test]
    procedure CheckoutQueuesNumberedEntry()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "HX056 Queue Spy";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        InitProcedure();
        CreateVehicle('HX056-6K');
        ClearOutbox('HX056-6K');
        ContractNo := RentalMgt.CreateContract('HX056-6K', 'HX056', 20270301D, 20270303D);
        BindSubscription(Spy);

        RentalMgt.CheckOut(ContractNo);

        Entry.SetRange("Vehicle No.", 'HX056-6K');
        Assert.AreEqual(1, Entry.Count(), 'The checkout queues one entry');
        Entry.FindFirst();
        Assert.IsTrue(Entry."Correlation No." > 0, 'The checkout entry carries a correlation number');
        Assert.AreEqual(1, Spy.Calls(), 'OnAfterQueueEntry is raised once for the checkout');
        Assert.AreEqual(Entry."Correlation No.", Spy.NumberAt(1), 'The event carries the checkout entry''s number');
        Assert.AreEqual(Entry."Entry No.", Spy.EntryNoAt(1), 'The event carries the stored checkout entry');
        Assert.IsTrue(Spy.StoredAt(1), 'The checkout entry is stored when the event is raised');
    end;

    [Test]
    procedure PayloadProcedureUnchanged()
    var
        Facade: Codeunit "CGR Integration Facade";
    begin
        InitProcedure();
        Assert.AreEqual('{"event":"vehicleCheckedOut","vehicleNo":"HX056-7"}',
            Facade.VehicleCheckedOutPayload('HX056-7'), 'VehicleCheckedOutPayload is unchanged');
    end;

    [Test]
    procedure CorrelationFieldAsSpecified()
    var
        RecRef: RecordRef;
        FldRef: FieldRef;
    begin
        InitProcedure();
        RecRef.Open(Database::"CGR Outbox Entry");
        Assert.IsTrue(RecRef.FieldExist(11), 'CGR Outbox Entry has field 11');
        FldRef := RecRef.Field(11);
        Assert.AreEqual('Correlation No.', FldRef.Name(), 'Field 11 is Correlation No.');
        Assert.IsTrue(FldRef.Type() = FieldType::BigInteger, 'Field 11 is a BigInteger');
        RecRef.Close();
    end;

    [Test]
    procedure DispatchKeepsNumber()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "HX056 Queue Spy";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
        NumberBefore: BigInteger;
    begin
        InitProcedure();
        ClearOutbox('HX056-9A');
        BindSubscription(Spy);
        EntryNo := QueueEntry('HX056-9A');
        Entry.Get(EntryNo);
        NumberBefore := Entry."Correlation No.";
        Assert.IsTrue(NumberBefore > 0, 'The queued entry carries a correlation number');

        Assert.IsTrue(Dispatcher.DispatchEntry(EntryNo), 'The entry is delivered');

        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Sent, 'The entry is sent');
        Assert.AreEqual(NumberBefore, Entry."Correlation No.", 'Dispatch keeps the correlation number');
    end;

    local procedure InitProcedure()
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

    local procedure ClearOutbox(VehicleNo: Code[20])
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange("Vehicle No.", VehicleNo);
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

    local procedure CreateVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Contract: Record "CGR Rental Contract";
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle.Strategy := Vehicle.Strategy::Default;
        Vehicle."Daily Rate" := 50;
        Vehicle.Insert();
    end;
}
