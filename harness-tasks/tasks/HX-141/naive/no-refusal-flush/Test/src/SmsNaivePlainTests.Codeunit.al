codeunit 80494 "CGR SMS Naive Plain Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        CheckoutSms: Codeunit "CGR Checkout SMS";

    [Test]
    procedure PlainCheckOutQueuesSms()
    begin
        HX141PlainPrepare();
        CheckoutSms.CheckOutAndNotify(HX141PlainContract('HX141-PA1'));
        CheckoutSms.CheckOutAndNotify(HX141PlainContract('HX141-PA2'));
        Assert.AreEqual(2, CheckoutSms.PendingCount(), 'Two check-outs queue two SMS');
    end;

    [Test]
    procedure PlainKeyBoxRefusalQueuesNothing()
    var
        Spy: Codeunit "CGR SMS Naive Plain Spy";
        ContractNo: Code[20];
    begin
        HX141PlainPrepare();
        ContractNo := HX141PlainContract('HX141-PK1');
        Spy.BlockKeysPlain('HX141-PK1');
        BindSubscription(Spy);
        Commit();
        asserterror CheckoutSms.CheckOutAndNotify(ContractNo);
        UnbindSubscription(Spy);
        Assert.ExpectedError(Spy.PlainKeyBoxText('HX141-PK1'));
        Assert.AreEqual(0, CheckoutSms.PendingCount(), 'Refused check-out queues nothing');
    end;

    [Test]
    procedure PlainFlushSendsAndEmpties()
    var
        Spy: Codeunit "CGR SMS Naive Plain Spy";
    begin
        HX141PlainPrepare();
        CheckoutSms.CheckOutAndNotify(HX141PlainContract('HX141-PF1'));
        CheckoutSms.CheckOutAndNotify(HX141PlainContract('HX141-PF2'));
        BindSubscription(Spy);
        Commit();
        Assert.AreEqual(2, CheckoutSms.Flush(), 'Flush sends both');
        Assert.AreEqual(0, CheckoutSms.PendingCount(), 'Queue empty after Flush');
        Assert.AreEqual(0, CheckoutSms.Flush(), 'Second Flush sends nothing');
        UnbindSubscription(Spy);
        Assert.AreEqual(2, Spy.PlainSmsCount(), 'Gateway got two SMS');
    end;

    [Test]
    procedure PlainResetEmptiesQueue()
    begin
        HX141PlainPrepare();
        CheckoutSms.CheckOutAndNotify(HX141PlainContract('HX141-PR1'));
        CheckoutSms.Reset();
        Assert.AreEqual(0, CheckoutSms.PendingCount(), 'Reset empties the queue');
    end;

    local procedure HX141PlainPrepare()
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        CheckoutSms.Reset();
    end;

    local procedure HX141PlainContract(VehicleNo: Code[20]): Code[20]
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        exit(Lib.CreateContract(VehicleNo));
    end;
}
