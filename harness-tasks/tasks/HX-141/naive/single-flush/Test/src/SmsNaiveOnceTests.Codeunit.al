codeunit 80498 "CGR SMS Naive Once Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        CheckoutSms: Codeunit "CGR Checkout SMS";
        OnceNotAvailableTxt: Label 'Vehicle %1 is not available.', Locked = true;

    [Test]
    procedure OnceKeyBoxRefusalQueuesNothing()
    var
        Spy: Codeunit "CGR SMS Naive Once Spy";
        ContractNo: Code[20];
    begin
        HX141OncePrepare();
        ContractNo := HX141OnceContract('HX141-OK1');
        Spy.OnceLockKeys('HX141-OK1');
        BindSubscription(Spy);
        Commit();
        asserterror CheckoutSms.CheckOutAndNotify(ContractNo);
        UnbindSubscription(Spy);
        Assert.ExpectedError(Spy.OnceKeyBoxText('HX141-OK1'));
        Assert.AreEqual(0, CheckoutSms.PendingCount(), 'Refused check-out queues nothing');
    end;

    [Test]
    procedure OnceBlockedThenRetried()
    var
        Vehicle: Record "CGR Vehicle";
        ContractNo: Code[20];
    begin
        HX141OncePrepare();
        ContractNo := HX141OnceContract('HX141-OB1');
        Vehicle.Get('HX141-OB1');
        Vehicle.Blocked := true;
        Vehicle.Modify();
        Commit();
        asserterror CheckoutSms.CheckOutAndNotify(ContractNo);
        Assert.ExpectedError(StrSubstNo(OnceNotAvailableTxt, 'HX141-OB1'));
        Vehicle.Get('HX141-OB1');
        Vehicle.Blocked := false;
        Vehicle.Modify();
        CheckoutSms.CheckOutAndNotify(ContractNo);
        Assert.AreEqual(1, CheckoutSms.PendingCount(), 'Only the successful retry queued an SMS');
    end;

    [Test]
    procedure OnceFlushSendsAll()
    var
        Spy: Codeunit "CGR SMS Naive Once Spy";
        FirstNo: Code[20];
        SecondNo: Code[20];
    begin
        HX141OncePrepare();
        FirstNo := HX141OnceContract('HX141-OF1');
        SecondNo := HX141OnceContract('HX141-OF2');
        CheckoutSms.CheckOutAndNotify(FirstNo);
        CheckoutSms.CheckOutAndNotify(SecondNo);
        BindSubscription(Spy);
        Commit();
        Assert.AreEqual(2, CheckoutSms.Flush(), 'Flush sends both');
        UnbindSubscription(Spy);
        Assert.AreEqual(2, Spy.OnceSentCount(), 'Two deliveries');
        Assert.IsTrue(Spy.OnceWasSent(FirstNo), 'First contract sent');
        Assert.IsTrue(Spy.OnceWasSent(SecondNo), 'Second contract sent');
    end;

    [Test]
    procedure OnceRefusalCountsOnlySent()
    var
        Spy: Codeunit "CGR SMS Naive Once Spy";
        RefusedNo: Code[20];
        OtherNo: Code[20];
    begin
        HX141OncePrepare();
        RefusedNo := HX141OnceContract('HX141-OR1');
        OtherNo := HX141OnceContract('HX141-OR2');
        CheckoutSms.CheckOutAndNotify(RefusedNo);
        CheckoutSms.CheckOutAndNotify(OtherNo);
        Spy.OnceRefuseSms(RefusedNo);
        BindSubscription(Spy);
        Commit();
        Assert.AreEqual(1, CheckoutSms.Flush(), 'Only the accepted SMS counts');
        UnbindSubscription(Spy);
        Assert.IsTrue(Spy.OnceWasSent(OtherNo), 'The accepted SMS was sent');
        Assert.IsFalse(Spy.OnceWasSent(RefusedNo), 'The refused SMS was not sent');
    end;

    [Test]
    procedure OnceResetEmpties()
    begin
        HX141OncePrepare();
        CheckoutSms.CheckOutAndNotify(HX141OnceContract('HX141-OX1'));
        CheckoutSms.Reset();
        Assert.AreEqual(0, CheckoutSms.PendingCount(), 'Reset empties the queue');
    end;

    local procedure HX141OncePrepare()
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        CheckoutSms.Reset();
    end;

    local procedure HX141OnceContract(VehicleNo: Code[20]): Code[20]
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        exit(Lib.CreateContract(VehicleNo));
    end;
}
