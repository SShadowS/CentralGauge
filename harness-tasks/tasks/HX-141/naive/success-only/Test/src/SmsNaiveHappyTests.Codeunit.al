codeunit 80496 "CGR SMS Naive Happy Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        CheckoutSms: Codeunit "CGR Checkout SMS";

    [Test]
    procedure HappyCheckOutQueuesOne()
    begin
        HX141HappyPrepare();
        CheckoutSms.CheckOutAndNotify(HX141HappyContract('HX141-HA1'));
        Assert.AreEqual(1, CheckoutSms.PendingCount(), 'One SMS queued');
    end;

    [Test]
    procedure HappyFlushTwice()
    var
        Spy: Codeunit "CGR SMS Naive Happy Spy";
    begin
        HX141HappyPrepare();
        CheckoutSms.CheckOutAndNotify(HX141HappyContract('HX141-HF1'));
        CheckoutSms.CheckOutAndNotify(HX141HappyContract('HX141-HF2'));
        BindSubscription(Spy);
        Commit();
        Assert.AreEqual(2, CheckoutSms.Flush(), 'Both sent');
        Assert.AreEqual(0, CheckoutSms.Flush(), 'Nothing left');
        UnbindSubscription(Spy);
        Assert.AreEqual(2, Spy.HappySentCount(), 'Two deliveries');
    end;

    [Test]
    procedure HappyRefusedStaysQueued()
    var
        Spy: Codeunit "CGR SMS Naive Happy Spy";
        RefusedNo: Code[20];
        OtherNo: Code[20];
    begin
        HX141HappyPrepare();
        RefusedNo := HX141HappyContract('HX141-HR1');
        OtherNo := HX141HappyContract('HX141-HR2');
        CheckoutSms.CheckOutAndNotify(RefusedNo);
        CheckoutSms.CheckOutAndNotify(OtherNo);
        Spy.HappyRefuse(RefusedNo);
        BindSubscription(Spy);
        Commit();
        Assert.AreEqual(1, CheckoutSms.Flush(), 'One sent');
        UnbindSubscription(Spy);
        Assert.AreEqual(1, CheckoutSms.PendingCount(), 'Refused one stays');
        Assert.IsTrue(Spy.HappyWasSent(OtherNo), 'The other one was sent');
        Assert.IsFalse(Spy.HappyWasSent(RefusedNo), 'The refused one was not sent');
    end;

    [Test]
    procedure HappyResetEmpties()
    begin
        HX141HappyPrepare();
        CheckoutSms.CheckOutAndNotify(HX141HappyContract('HX141-HX1'));
        CheckoutSms.Reset();
        Assert.AreEqual(0, CheckoutSms.PendingCount(), 'Reset empties the queue');
    end;

    local procedure HX141HappyPrepare()
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        CheckoutSms.Reset();
    end;

    local procedure HX141HappyContract(VehicleNo: Code[20]): Code[20]
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        exit(Lib.CreateContract(VehicleNo));
    end;
}
