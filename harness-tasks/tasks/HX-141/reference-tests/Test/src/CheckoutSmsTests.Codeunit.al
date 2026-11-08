codeunit 80490 "CGR Checkout SMS Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        CheckoutSms: Codeunit "CGR Checkout SMS";
        VehicleNotAvailableTxt: Label 'Vehicle %1 is not available.', Locked = true;

    [Test]
    procedure SuccessfulCheckOutsQueueOneSmsEach()
    var
        FirstNo: Code[20];
        SecondNo: Code[20];
    begin
        HX141Prepare();
        FirstNo := HX141Contract('HX141-S1');
        SecondNo := HX141Contract('HX141-S2');

        CheckoutSms.CheckOutAndNotify(FirstNo);
        Assert.AreEqual(1, CheckoutSms.PendingCount(), 'One SMS is queued after the first check-out');
        CheckoutSms.CheckOutAndNotify(SecondNo);
        Assert.AreEqual(2, CheckoutSms.PendingCount(), 'One more SMS is queued after the second check-out');
    end;

    [Test]
    procedure KeyBoxRefusalQueuesNothing()
    var
        KeyBox: Codeunit "CGR Key Box Refusal Spy";
        RefusedNo: Code[20];
        OtherNo: Code[20];
    begin
        HX141Prepare();
        RefusedNo := HX141Contract('HX141-K1');
        OtherNo := HX141Contract('HX141-K2');
        KeyBox.RefuseKeysFor('HX141-K1');
        BindSubscription(KeyBox);

        Commit();
        asserterror CheckoutSms.CheckOutAndNotify(RefusedNo);
        Assert.ExpectedError(KeyBox.KeyBoxRefusalText('HX141-K1'));
        Assert.AreEqual(0, CheckoutSms.PendingCount(), 'A check-out refused by the key box queues no SMS');

        CheckoutSms.CheckOutAndNotify(OtherNo);
        UnbindSubscription(KeyBox);
        Assert.AreEqual(1, CheckoutSms.PendingCount(), 'A check-out the key box accepts queues one SMS');
    end;

    [Test]
    procedure BlockedVehicleRetryQueuesOneSms()
    var
        Vehicle: Record "CGR Vehicle";
        ContractNo: Code[20];
    begin
        HX141Prepare();
        ContractNo := HX141Contract('HX141-B1');
        Vehicle.Get('HX141-B1');
        Vehicle.Blocked := true;
        Vehicle.Modify();

        Commit();
        asserterror CheckoutSms.CheckOutAndNotify(ContractNo);
        Assert.ExpectedError(StrSubstNo(VehicleNotAvailableTxt, 'HX141-B1'));
        Assert.AreEqual(0, CheckoutSms.PendingCount(), 'A check-out of a blocked vehicle queues no SMS');

        Vehicle.Get('HX141-B1');
        Vehicle.Blocked := false;
        Vehicle.Modify();
        CheckoutSms.CheckOutAndNotify(ContractNo);
        Assert.AreEqual(1, CheckoutSms.PendingCount(), 'The retried check-out queues exactly one SMS');
    end;

    [Test]
    procedure FlushSendsEachQueuedSmsOnce()
    var
        Gateway: Codeunit "CGR SMS Gateway Spy";
        FirstNo: Code[20];
        SecondNo: Code[20];
        Sent: Integer;
    begin
        HX141Prepare();
        FirstNo := HX141Contract('HX141-F1');
        SecondNo := HX141Contract('HX141-F2');
        CheckoutSms.CheckOutAndNotify(FirstNo);
        CheckoutSms.CheckOutAndNotify(SecondNo);
        BindSubscription(Gateway);

        Commit();
        Sent := CheckoutSms.Flush();

        Assert.AreEqual(2, Sent, 'Flush returns the number of SMS sent');
        Assert.AreEqual(0, CheckoutSms.PendingCount(), 'Sent SMS leave the queue');
        Assert.AreEqual(0, CheckoutSms.Flush(), 'A second Flush has nothing left to send');
        UnbindSubscription(Gateway);
        Assert.AreEqual(2, Gateway.SmsDeliveryTotal(), 'The gateway received two SMS in total');
        Assert.AreEqual(1, Gateway.DeliveriesFor(FirstNo), 'The first contract got one SMS');
        Assert.AreEqual(1, Gateway.DeliveriesFor(SecondNo), 'The second contract got one SMS');
        Assert.AreEqual('Your car HX141-F1 is ready.', Gateway.DeliveredTextFor(FirstNo), 'SMS text of the first contract');
    end;

    [Test]
    procedure RefusedSmsStaysQueuedAndFlushContinues()
    var
        Gateway: Codeunit "CGR SMS Gateway Spy";
        Runner: Codeunit "CGR SMS Flush Runner";
        RefusedNo: Code[20];
        AcceptedNo: Code[20];
        Ok: Boolean;
    begin
        HX141Prepare();
        RefusedNo := HX141Contract('HX141-R1');
        AcceptedNo := HX141Contract('HX141-R2');
        CheckoutSms.CheckOutAndNotify(RefusedNo);
        CheckoutSms.CheckOutAndNotify(AcceptedNo);
        Gateway.RefuseSmsFor(RefusedNo);
        BindSubscription(Gateway);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Flush finishes although the gateway refuses one SMS: ' + GetLastErrorText());
        Assert.AreEqual(1, Runner.FlushedCount(), 'Flush returns the number sent, not the number tried');
        Assert.AreEqual(1, CheckoutSms.PendingCount(), 'The refused SMS stays queued');
        Assert.AreEqual(1, Gateway.DeliveriesFor(AcceptedNo), 'The SMS after the refused one is sent');
        Assert.AreEqual(0, Gateway.DeliveriesFor(RefusedNo), 'The refused SMS is not delivered');

        Gateway.AcceptEverySms();
        Assert.AreEqual(1, CheckoutSms.Flush(), 'The next Flush sends the SMS that was refused');
        UnbindSubscription(Gateway);
        Assert.AreEqual(1, Gateway.DeliveriesFor(RefusedNo), 'The refused SMS is delivered on the next Flush');
        Assert.AreEqual(1, Gateway.DeliveriesFor(AcceptedNo), 'The SMS sent earlier is not sent again');
        Assert.AreEqual(0, CheckoutSms.PendingCount(), 'The queue is empty after both are sent');
    end;

    [Test]
    procedure ResetDropsTheQueue()
    var
        Gateway: Codeunit "CGR SMS Gateway Spy";
    begin
        HX141Prepare();
        CheckoutSms.CheckOutAndNotify(HX141Contract('HX141-X1'));
        Assert.AreEqual(1, CheckoutSms.PendingCount(), 'One SMS is queued');

        CheckoutSms.Reset();
        Assert.AreEqual(0, CheckoutSms.PendingCount(), 'Reset drops the queued SMS');
        BindSubscription(Gateway);
        Commit();
        Assert.AreEqual(0, CheckoutSms.Flush(), 'Nothing is sent after Reset');
        UnbindSubscription(Gateway);
        Assert.AreEqual(0, Gateway.SmsDeliveryTotal(), 'The gateway received nothing after Reset');
    end;

    local procedure HX141Prepare()
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        CheckoutSms.Reset();
    end;

    local procedure HX141Contract(VehicleNo: Code[20]): Code[20]
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        exit(Lib.CreateContract(VehicleNo));
    end;
}
