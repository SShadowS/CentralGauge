// Every procedure switches both mirrors off through the old Stop procedures and then CGR Desk Mirror, each in its own runner call whose
// outcome is not asserted, at start and end (a SingleInstance binding and its flags outlive a procedure). Every
// runner call commits first. The Is* answers are read through fresh local variables.
codeunit 87160 "HX085 Desk Mirror Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Step: Option StartCheckout,StopCheckout,StartReturn,StopReturn,CheckoutOn,CheckoutOff,ReturnOn,ReturnOff;

    [Test]
    procedure CheckoutMirrorOnly()
    var
        CheckoutMirror: Codeunit "CGR Checkout Mirror";
    begin
        HX85Prepare();
        HX85Vehicle('HX085-1A');

        CheckoutMirror.StartCheckoutMirror();
        CheckoutMirror.StartCheckoutMirror();
        HX85Rent('HX085-1A', true);

        Assert.AreEqual(1, HX85Count('HX085-1A', 'mirrorCheckOut'), 'A checkout queues one mirrorCheckOut entry, also after starting twice');
        HX85AssertEntry('HX085-1A', 'mirrorCheckOut');
        Assert.AreEqual(0, HX85Count('HX085-1A', 'mirrorReturn'), 'The return mirror is off: no mirrorReturn entry');
        Assert.IsTrue(HX85CheckoutOn(), 'The checkout mirror is on');
        Assert.IsTrue(HX85DeskCheckoutOn(), 'CGR Desk Mirror reports the checkout mirror on');
        Assert.IsFalse(HX85ReturnOn(), 'The return mirror is off');
        HX85MirrorsOff();
    end;

    [Test]
    procedure ReturnMirrorOnly()
    var
        ReturnMirror: Codeunit "CGR Return Mirror";
    begin
        HX85Prepare();
        HX85Vehicle('HX085-2B');

        ReturnMirror.StartReturnMirror();
        HX85Rent('HX085-2B', true);

        Assert.AreEqual(0, HX85Count('HX085-2B', 'mirrorCheckOut'), 'The checkout mirror is off: no mirrorCheckOut entry');
        Assert.AreEqual(1, HX85Count('HX085-2B', 'mirrorReturn'), 'A return queues one mirrorReturn entry');
        HX85AssertEntry('HX085-2B', 'mirrorReturn');
        Assert.IsFalse(HX85CheckoutOn(), 'The checkout mirror is off');
        Assert.IsTrue(HX85ReturnOn(), 'The return mirror is on');
        HX85MirrorsOff();
    end;

    [Test]
    procedure BothMirrors()
    var
        Runner: Codeunit "HX085 Mirror Runner";
    begin
        HX85Prepare();
        HX85Vehicle('HX085-3C');

        Runner.AddStep(Step::StartCheckout);
        Runner.AddStep(Step::StartReturn);
        Commit();
        Assert.IsTrue(Runner.Run(), StrSubstNo('Both mirrors can be switched on: %1', GetLastErrorText()));
        HX85Rent('HX085-3C', true);

        Assert.AreEqual(1, HX85Count('HX085-3C', 'mirrorCheckOut'), 'Both on: one mirrorCheckOut entry');
        Assert.AreEqual(1, HX85Count('HX085-3C', 'mirrorReturn'), 'Both on: one mirrorReturn entry');
        HX85MirrorsOff();
    end;

    [Test]
    procedure StopReturnKeepsCheckout()
    var
        CheckoutMirror: Codeunit "CGR Checkout Mirror";
        ReturnMirror: Codeunit "CGR Return Mirror";
    begin
        HX85Prepare();
        HX85Vehicle('HX085-4D');
        CheckoutMirror.StartCheckoutMirror();
        ReturnMirror.StartReturnMirror();
        Assert.IsTrue(HX85ReturnOn(), 'Precondition: the return mirror is on');

        ReturnMirror.StopReturnMirror();
        HX85Rent('HX085-4D', true);

        Assert.AreEqual(1, HX85Count('HX085-4D', 'mirrorCheckOut'), 'The checkout mirror keeps mirroring after the return mirror stops');
        Assert.AreEqual(0, HX85Count('HX085-4D', 'mirrorReturn'), 'A stopped return mirror queues nothing');
        Assert.IsTrue(HX85CheckoutOn(), 'The checkout mirror is still on');
        Assert.IsFalse(HX85ReturnOn(), 'The return mirror is off');
        HX85MirrorsOff();
    end;

    [Test]
    procedure OffMirrorsQueueNothing()
    begin
        HX85Prepare();
        HX85Vehicle('HX085-5E');
        Assert.IsFalse(HX85CheckoutOn(), 'Precondition: the checkout mirror is off');
        Assert.IsFalse(HX85ReturnOn(), 'Precondition: the return mirror is off');

        HX85Rent('HX085-5E', true);

        Assert.AreEqual(0, HX85Count('HX085-5E', 'mirrorCheckOut'), 'No mirror on: no mirrorCheckOut entry');
        Assert.AreEqual(0, HX85Count('HX085-5E', 'mirrorReturn'), 'No mirror on: no mirrorReturn entry');
        Assert.AreEqual(1, HX85Count('HX085-5E', 'vehicleCheckedOut'), 'The checkout still queues its own vehicleCheckedOut entry');
        HX85MirrorsOff();
    end;

    [Test]
    procedure SessionWideMirror()
    begin
        HX85Prepare();
        HX85Vehicle('HX085-6F');

        HX85StartInHelper();
        HX85Rent('HX085-6F', false);

        Assert.AreEqual(1, HX85Count('HX085-6F', 'mirrorCheckOut'), 'A mirror switched on in a procedure that has returned still mirrors');
        Assert.IsTrue(HX85CheckoutOn(), 'The checkout mirror is on for a fresh variable');
        HX85MirrorsOff();
    end;

    [Test]
    procedure NewProceduresDirect()
    var
        AllObj: Record AllObj;
        Runner: Codeunit "HX085 Mirror Runner";
        Runner2: Codeunit "HX085 Mirror Runner";
    begin
        HX85Prepare();
        HX85Vehicle('HX085-7G');
        HX85Vehicle('HX085-7K');
        Assert.IsTrue(AllObj.Get(AllObj."Object Type"::Codeunit, 70429), 'Codeunit 70429 exists');
        Assert.AreEqual('CGR Desk Mirror', AllObj."Object Name", 'Codeunit 70429 is CGR Desk Mirror');

        Runner.AddStep(Step::CheckoutOn);
        Runner.AddStep(Step::CheckoutOn);
        Runner.AddStep(Step::ReturnOff);
        Commit();
        Assert.IsTrue(Runner.Run(), StrSubstNo('Switching on twice and off when off raises no error: %1', GetLastErrorText()));

        Assert.IsTrue(HX85DeskCheckoutOn(), 'SetCheckoutMirror(true) switches the checkout mirror on');
        Assert.IsTrue(HX85CheckoutOn(), 'CGR Checkout Mirror reports the mirror switched on through CGR Desk Mirror');
        Assert.IsFalse(HX85DeskReturnOn(), 'The return mirror stays off');
        HX85Rent('HX085-7G', true);
        Assert.AreEqual(1, HX85Count('HX085-7G', 'mirrorCheckOut'), 'One mirrorCheckOut entry after switching on twice');
        Assert.AreEqual(0, HX85Count('HX085-7G', 'mirrorReturn'), 'No mirrorReturn entry while the return mirror is off');

        Runner2.AddStep(Step::ReturnOn);
        Runner2.AddStep(Step::CheckoutOff);
        Commit();
        Assert.IsTrue(Runner2.Run(), StrSubstNo('Switching return on and checkout off raises no error: %1', GetLastErrorText()));

        Assert.IsFalse(HX85DeskCheckoutOn(), 'SetCheckoutMirror(false) switches the checkout mirror off');
        Assert.IsTrue(HX85DeskReturnOn(), 'SetReturnMirror(true) switches the return mirror on');
        HX85Rent('HX085-7K', true);
        Assert.AreEqual(0, HX85Count('HX085-7K', 'mirrorCheckOut'), 'No mirrorCheckOut entry after SetCheckoutMirror(false)');
        Assert.AreEqual(1, HX85Count('HX085-7K', 'mirrorReturn'), 'One mirrorReturn entry after SetReturnMirror(true)');
        HX85MirrorsOff();
    end;

    [Test]
    procedure StopWhenOffAndRestart()
    begin
        HX85Prepare();
        HX85Vehicle('HX085-8H');

        Assert.IsTrue(HX85RunStep(Step::StopCheckout), StrSubstNo('Stopping a mirror that is off raises no error: %1', GetLastErrorText()));
        Assert.IsTrue(HX85RunStep(Step::StartCheckout), StrSubstNo('First start: %1', GetLastErrorText()));
        Assert.IsTrue(HX85RunStep(Step::StopCheckout), StrSubstNo('Stop: %1', GetLastErrorText()));
        Assert.IsFalse(HX85CheckoutOn(), 'The checkout mirror is off after the stop');
        Assert.IsTrue(HX85RunStep(Step::StartCheckout), StrSubstNo('Start again after the stop: %1', GetLastErrorText()));
        HX85Rent('HX085-8H', false);

        Assert.AreEqual(1, HX85Count('HX085-8H', 'mirrorCheckOut'), 'A mirror started again after a stop mirrors once');
        Assert.IsTrue(HX85CheckoutOn(), 'The checkout mirror is on after the restart');
        HX85MirrorsOff();
    end;

    [Test]
    procedure LegacyReturnDeskStops()
    var
        ReturnMirror: Codeunit "CGR Return Mirror";
    begin
        HX85Prepare();
        HX85Vehicle('HX085-9J');
        HX85Vehicle('HX085-9M');

        ReturnMirror.StartReturnMirror();
        Assert.IsTrue(HX85DeskReturnOn(), 'CGR Desk Mirror reports the return mirror started through CGR Return Mirror');
        HX85Rent('HX085-9J', true);
        Assert.AreEqual(1, HX85Count('HX085-9J', 'mirrorReturn'), 'One mirrorReturn entry after StartReturnMirror');
        Assert.AreEqual(0, HX85Count('HX085-9J', 'mirrorCheckOut'), 'No mirrorCheckOut entry while the checkout mirror is off');

        Assert.IsTrue(HX85RunStep(Step::ReturnOff), StrSubstNo('SetReturnMirror(false) stops the mirror: %1', GetLastErrorText()));
        Assert.IsFalse(HX85ReturnOn(), 'CGR Return Mirror reports the mirror stopped through CGR Desk Mirror');
        HX85Rent('HX085-9M', true);
        Assert.AreEqual(0, HX85Count('HX085-9M', 'mirrorReturn'), 'No mirrorReturn entry after SetReturnMirror(false)');
        HX85MirrorsOff();
    end;

    [Test]
    procedure DeskReturnLegacyStops()
    begin
        HX85Prepare();
        HX85Vehicle('HX085-10N');
        HX85Vehicle('HX085-10P');

        Assert.IsTrue(HX85RunStep(Step::ReturnOn), StrSubstNo('SetReturnMirror(true): %1', GetLastErrorText()));
        Assert.IsTrue(HX85ReturnOn(), 'CGR Return Mirror reports the mirror started through CGR Desk Mirror');
        HX85Rent('HX085-10N', true);
        Assert.AreEqual(1, HX85Count('HX085-10N', 'mirrorReturn'), 'One mirrorReturn entry after SetReturnMirror(true)');
        Assert.AreEqual(0, HX85Count('HX085-10N', 'mirrorCheckOut'), 'No mirrorCheckOut entry while the checkout mirror is off');

        Assert.IsTrue(HX85RunStep(Step::StopReturn), StrSubstNo('StopReturnMirror stops the mirror: %1', GetLastErrorText()));
        Assert.IsFalse(HX85DeskReturnOn(), 'CGR Desk Mirror reports the mirror stopped through CGR Return Mirror');
        HX85Rent('HX085-10P', true);
        Assert.AreEqual(0, HX85Count('HX085-10P', 'mirrorReturn'), 'No mirrorReturn entry after StopReturnMirror');
        HX85MirrorsOff();
    end;

    local procedure HX85StartInHelper()
    var
        CheckoutMirror: Codeunit "CGR Checkout Mirror";
    begin
        CheckoutMirror.StartCheckoutMirror();
    end;

    local procedure HX85CheckoutOn(): Boolean
    var
        CheckoutMirror: Codeunit "CGR Checkout Mirror";
    begin
        exit(CheckoutMirror.IsCheckoutMirrorOn());
    end;

    local procedure HX85ReturnOn(): Boolean
    var
        ReturnMirror: Codeunit "CGR Return Mirror";
    begin
        exit(ReturnMirror.IsReturnMirrorOn());
    end;

    local procedure HX85DeskCheckoutOn(): Boolean
    var
        DeskMirror: Codeunit "CGR Desk Mirror";
    begin
        exit(DeskMirror.IsCheckoutMirrorOn());
    end;

    local procedure HX85DeskReturnOn(): Boolean
    var
        DeskMirror: Codeunit "CGR Desk Mirror";
    begin
        exit(DeskMirror.IsReturnMirrorOn());
    end;

    local procedure HX85RunStep(NewStep: Option StartCheckout,StopCheckout,StartReturn,StopReturn,CheckoutOn,CheckoutOff,ReturnOn,ReturnOff): Boolean
    var
        Runner: Codeunit "HX085 Mirror Runner";
    begin
        Runner.AddStep(NewStep);
        Commit();
        exit(Runner.Run());
    end;

    local procedure HX85MirrorsOff()
    begin
        if HX85RunStep(Step::StopCheckout) then;
        Commit();
        if HX85RunStep(Step::StopReturn) then;
        Commit();
        if HX85RunStep(Step::CheckoutOff) then;
        Commit();
        if HX85RunStep(Step::ReturnOff) then;
        Commit();
    end;

    local procedure HX85Rent(VehicleNo: Code[20]; ReturnToo: Boolean)
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX085 Customer', 20270301D, 20270303D);
        RentalMgt.CheckOut(ContractNo);
        if ReturnToo then
            RentalMgt.Return(ContractNo, 1100, '');
    end;

    local procedure HX85Count(VehicleNo: Code[20]; EventType: Text[50]): Integer
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.SetRange("Event Type", EventType);
        exit(Entry.Count());
    end;

    local procedure HX85AssertEntry(VehicleNo: Code[20]; EventType: Text[50])
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.SetRange("Event Type", EventType);
        Entry.FindFirst();
        Assert.AreEqual(StrSubstNo('{"event":"%1","vehicleNo":"%2"}', EventType, VehicleNo), Entry.Payload, 'The mirror entry carries the stated payload');
        Assert.AreNotEqual(0DT, Entry."Created At", 'The mirror entry has Created At set');
        Assert.IsFalse(Entry.Sent, 'The mirror entry is not sent yet');
        Assert.AreEqual(0, Entry.Attempts, 'The mirror entry has no attempts yet');
    end;

    local procedure HX85Vehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Contract: Record "CGR Rental Contract";
        Entry: Record "CGR Outbox Entry";
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle.Strategy := Enum::"CGR Maintenance Strategy"::Default;
        Vehicle.Insert();
    end;

    local procedure HX85Prepare()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        HX85MirrorsOff();
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := 0;
        Setup."Km Allowance per Day" := 1000;
        Setup."Excess Km Rate" := 0;
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup."Outbox Max Attempts" := 3;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
    end;
}
