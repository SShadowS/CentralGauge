// Every row sets its own work date and pricing setup, owns its vehicles and contracts (HX132-<row>, deleted first)
// and binds its own spy (a local Manual binding ends with the procedure). Seeds are committed before every
// asserterror, so what is read back afterwards is what the code under test left, not a rolled-back seed. The spy's
// lists are in memory and survive the rollback: a release made inside a failed attempt is still counted.
codeunit 87940 "HX132 Card Hold Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        NotAvailableTxt: Label 'Vehicle %1 is not available.', Locked = true;

    [Test]
    procedure FailedCheckOutKeepsHold()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Spy: Codeunit "HX132 Card Provider Spy";
        ContractNo: Code[20];
    begin
        Prepare();
        CreateVehicle('HX132-1V', 1000, 40, true);
        ContractNo := CreateContract('HX132-1V');
        Spy.Init('HX132-1');
        BindSubscription(Spy);
        Commit();

        asserterror RentalMgt.CheckOut(ContractNo);

        Assert.ExpectedError(StrSubstNo(NotAvailableTxt, 'HX132-1V'));
        Assert.IsTrue(Spy.RequestCount() <= 1, 'A failed check-out places at most one hold');
        Contract.Get(ContractNo);
        if Spy.RequestCount() = 1 then begin
            Assert.AreEqual(Spy.IssuedCode(1), Contract."Payment Auth Code", 'The hold obtained before the failure stays on the contract');
            Assert.AreEqual(120, Contract."Authorized Amount", 'The authorized amount stays on the contract');
        end;
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'A failed check-out leaves the contract open');
        Assert.AreEqual(0, Contract."Start Km", 'A failed check-out leaves the start km');
        AssertVehicleCheckedOut('HX132-1V', false);
        Assert.AreEqual(0, Spy.ReleaseCount(), 'A failed check-out releases nothing');
    end;

    [Test]
    procedure RefusedCheckOutKeepsHold()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Spy: Codeunit "HX132 Card Provider Spy";
        ContractNo: Code[20];
    begin
        Prepare();
        CreateVehicle('HX132-2V', 1000, 40, false);
        ContractNo := CreateContract('HX132-2V');
        Spy.Init('HX132-2');
        Spy.SetRefuseKeys(true);
        BindSubscription(Spy);
        Commit();

        asserterror RentalMgt.CheckOut(ContractNo);

        Assert.ExpectedError(Spy.RefusalText(ContractNo));
        Assert.AreEqual(1, Spy.RequestCount(), 'The card is authorized once before the keys are handed out');
        Assert.AreEqual(120, Spy.IssuedAmount(1), 'The card is authorized for the expected amount');
        Assert.AreEqual(1, Spy.KeyBoxCount(), 'The key box was reached once');
        Assert.AreEqual(1, Spy.RequestsBeforeKeyBox(1), 'The card is authorized before the keys are handed out');
        Contract.Get(ContractNo);
        Assert.AreEqual(Spy.IssuedCode(1), Contract."Payment Auth Code", 'The hold obtained before the refusal stays on the contract');
        Assert.AreEqual(120, Contract."Authorized Amount", 'The authorized amount stays on the contract');
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'A refused check-out leaves the contract open');
        Assert.AreEqual(0, Contract."Start Km", 'A refused check-out leaves the start km');
        AssertVehicleCheckedOut('HX132-2V', false);

        Spy.SetRefuseKeys(false);
        RentalMgt.CheckOut(ContractNo);

        Assert.AreEqual(1, Spy.RequestCount(), 'The retried check-out uses the hold the contract already has');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'The retried check-out checks the contract out');
        Assert.AreEqual(Spy.IssuedCode(1), Contract."Payment Auth Code", 'The contract keeps its hold');
        AssertVehicleCheckedOut('HX132-2V', true);
        Assert.AreEqual(0, Spy.ReleaseCount(), 'Check-out releases nothing');
    end;

    [Test]
    procedure RetriedCheckOutReusesHold()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Spy: Codeunit "HX132 Card Provider Spy";
        ContractNo: Code[20];
    begin
        Prepare();
        CreateVehicle('HX132-3V', 1000, 40, true);
        ContractNo := CreateContract('HX132-3V');
        Spy.Init('HX132-3');
        BindSubscription(Spy);
        Commit();
        asserterror RentalMgt.CheckOut(ContractNo);
        Assert.ExpectedError(StrSubstNo(NotAvailableTxt, 'HX132-3V'));
        SetBlocked('HX132-3V', false);
        Commit();

        RentalMgt.CheckOut(ContractNo);

        Assert.AreEqual(1, Spy.RequestCount(), 'A retried check-out does not place a second hold');
        Contract.Get(ContractNo);
        Assert.AreEqual(Spy.IssuedCode(1), Contract."Payment Auth Code", 'The contract carries the one hold placed');
        Assert.AreEqual(120, Contract."Authorized Amount", 'The authorized amount is the expected amount');
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'The retried check-out checks the contract out');
        Assert.AreEqual(1000, Contract."Start Km", 'Start km is the vehicle mileage');
        AssertVehicleCheckedOut('HX132-3V', true);
        Assert.AreEqual(0, Spy.ReleaseCount(), 'Check-out releases nothing');
    end;

    [Test]
    procedure CheckOutAuthorizesExpectedAmount()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Spy: Codeunit "HX132 Card Provider Spy";
        ContractNo: Code[20];
    begin
        Prepare();
        CreateVehicle('HX132-4V', 1000, 40, false);
        ContractNo := CreateContract('HX132-4V');
        Spy.Init('HX132-4');
        BindSubscription(Spy);

        RentalMgt.CheckOut(ContractNo);

        Assert.AreEqual(1, Spy.RequestCount(), 'Check-out places one hold');
        Assert.AreEqual(120, Spy.IssuedAmount(1), 'The hold is for the expected amount');
        Assert.AreEqual(1, Spy.KeyBoxCount(), 'The key box was reached once');
        Assert.AreEqual(1, Spy.RequestsBeforeKeyBox(1), 'The card is authorized before the keys are handed out');
        Contract.Get(ContractNo);
        Assert.AreEqual(Spy.IssuedCode(1), Contract."Payment Auth Code", 'The contract carries the hold');
        Assert.AreEqual(120, Contract."Authorized Amount", 'The contract carries the authorized amount');
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'The contract is checked out');
        Assert.AreEqual(0, Spy.ReleaseCount(), 'Check-out releases nothing');
    end;

    [Test]
    procedure FailedSwapReleasesNothing()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        Spy: Codeunit "HX132 Card Provider Spy";
        ContractNo: Code[20];
    begin
        Prepare();
        CreateVehicle('HX132-5V', 1000, 40, false);
        CreateVehicle('HX132-5N', 2500, 70, true);
        ContractNo := CreateContract('HX132-5V');
        SeedCheckedOut(ContractNo, 'HX132-5V', 'HX132-5-OLD', 120);
        Spy.Init('HX132-5');
        BindSubscription(Spy);
        Commit();

        asserterror RentalMgt.SwapVehicle(ContractNo, 'HX132-5N');

        Assert.ExpectedError(StrSubstNo(NotAvailableTxt, 'HX132-5N'));
        Assert.AreEqual(0, Spy.ReleaseCount(), 'A failed swap releases no hold');
        Assert.IsTrue(Spy.RequestCount() <= 1, 'A failed swap places at most one hold');
        AssertContractVehicle(ContractNo, 'HX132-5V', 1000);
        AssertVehicleCheckedOut('HX132-5V', true);
        AssertVehicleCheckedOut('HX132-5N', false);
    end;

    [Test]
    procedure RefusedSwapReleasesNothing()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Spy: Codeunit "HX132 Card Provider Spy";
        ContractNo: Code[20];
    begin
        Prepare();
        CreateVehicle('HX132-6V', 1000, 40, false);
        CreateVehicle('HX132-6N', 2500, 70, false);
        ContractNo := CreateContract('HX132-6V');
        SeedCheckedOut(ContractNo, 'HX132-6V', 'HX132-6-OLD', 120);
        Spy.Init('HX132-6');
        Spy.SetRefuseKeys(true);
        BindSubscription(Spy);
        Commit();

        asserterror RentalMgt.SwapVehicle(ContractNo, 'HX132-6N');

        Assert.ExpectedError(Spy.RefusalText(ContractNo));
        Assert.AreEqual(0, Spy.ReleaseCount(), 'A swap the key box refuses releases no hold');
        Assert.AreEqual(1, Spy.RequestCount(), 'The card is authorized once for the new amount');
        Assert.AreEqual(210, Spy.IssuedAmount(1), 'The new hold is for the new expected amount');
        Assert.AreEqual(1, Spy.KeyBoxCount(), 'The key box was reached once');
        Assert.AreEqual(1, Spy.RequestsBeforeKeyBox(1), 'The card is authorized for the new amount before the keys are handed out');
        AssertContractVehicle(ContractNo, 'HX132-6V', 1000);
        AssertVehicleCheckedOut('HX132-6V', true);
        AssertVehicleCheckedOut('HX132-6N', false);

        Spy.SetRefuseKeys(false);
        RentalMgt.SwapVehicle(ContractNo, 'HX132-6N');

        Assert.AreEqual(1, Spy.RequestCount(), 'The retried swap uses the hold obtained before the refusal');
        Assert.AreEqual(1, Spy.ReleaseCount(), 'The old hold is released once when the swap goes through');
        Assert.AreEqual('HX132-6-OLD', Spy.ReleasedCode(1), 'The released hold is the old one');
        Contract.Get(ContractNo);
        Assert.AreEqual(Spy.IssuedCode(1), Contract."Payment Auth Code", 'The contract carries the new hold');
        Assert.AreEqual(210, Contract."Authorized Amount", 'The contract carries the new amount');
        AssertContractVehicle(ContractNo, 'HX132-6N', 2500);
    end;

    [Test]
    procedure RetriedSwapUsesNewHold()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Spy: Codeunit "HX132 Card Provider Spy";
        ContractNo: Code[20];
    begin
        Prepare();
        CreateVehicle('HX132-7V', 1000, 40, false);
        CreateVehicle('HX132-7N', 2500, 70, true);
        ContractNo := CreateContract('HX132-7V');
        SeedCheckedOut(ContractNo, 'HX132-7V', 'HX132-7-OLD', 120);
        Spy.Init('HX132-7');
        BindSubscription(Spy);
        Commit();
        asserterror RentalMgt.SwapVehicle(ContractNo, 'HX132-7N');
        Assert.ExpectedError(StrSubstNo(NotAvailableTxt, 'HX132-7N'));
        SetBlocked('HX132-7N', false);
        Commit();

        RentalMgt.SwapVehicle(ContractNo, 'HX132-7N');

        Assert.AreEqual(1, Spy.RequestCount(), 'A retried swap does not place a second hold');
        Assert.AreEqual(1, Spy.ReleaseCount(), 'The old hold is released exactly once');
        Assert.AreEqual('HX132-7-OLD', Spy.ReleasedCode(1), 'The released hold is the old one');
        Contract.Get(ContractNo);
        Assert.AreEqual(Spy.IssuedCode(1), Contract."Payment Auth Code", 'The contract carries the new hold');
        Assert.AreEqual(210, Contract."Authorized Amount", 'The contract carries the new amount');
        AssertContractVehicle(ContractNo, 'HX132-7N', 2500);
        AssertVehicleCheckedOut('HX132-7V', false);
        AssertVehicleCheckedOut('HX132-7N', true);
    end;

    [Test]
    procedure SwapReleasesOldHoldOnce()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Spy: Codeunit "HX132 Card Provider Spy";
        ContractNo: Code[20];
    begin
        Prepare();
        CreateVehicle('HX132-8V', 1000, 40, false);
        CreateVehicle('HX132-8N', 2500, 70, false);
        ContractNo := CreateContract('HX132-8V');
        SeedCheckedOut(ContractNo, 'HX132-8V', 'HX132-8-OLD', 120);
        Spy.Init('HX132-8');
        BindSubscription(Spy);

        RentalMgt.SwapVehicle(ContractNo, 'HX132-8N');

        Assert.AreEqual(1, Spy.RequestCount(), 'A swap to a more expensive vehicle places one hold');
        Assert.AreEqual(210, Spy.IssuedAmount(1), 'The new hold is for the new expected amount');
        Assert.AreEqual(1, Spy.KeyBoxCount(), 'The key box was reached once');
        Assert.AreEqual(1, Spy.RequestsBeforeKeyBox(1), 'The card is authorized for the new amount before the keys are handed out');
        Assert.AreEqual(1, Spy.ReleaseCount(), 'The old hold is released exactly once');
        Assert.AreEqual('HX132-8-OLD', Spy.ReleasedCode(1), 'The released hold is the old one');
        Contract.Get(ContractNo);
        Assert.AreEqual(Spy.IssuedCode(1), Contract."Payment Auth Code", 'The contract carries the new hold');
        Assert.AreEqual(210, Contract."Authorized Amount", 'The contract carries the new amount');
        AssertContractVehicle(ContractNo, 'HX132-8N', 2500);
    end;

    [Test]
    procedure CheaperSwapKeepsHold()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Spy: Codeunit "HX132 Card Provider Spy";
        ContractNo: Code[20];
    begin
        Prepare();
        CreateVehicle('HX132-9V', 1000, 40, false);
        CreateVehicle('HX132-9C', 3000, 20, false);
        ContractNo := CreateContract('HX132-9V');
        SeedCheckedOut(ContractNo, 'HX132-9V', 'HX132-9-OLD', 120);
        Spy.Init('HX132-9');
        BindSubscription(Spy);

        RentalMgt.SwapVehicle(ContractNo, 'HX132-9C');

        Assert.AreEqual(0, Spy.RequestCount(), 'A swap to a cheaper vehicle places no hold');
        Assert.AreEqual(0, Spy.ReleaseCount(), 'A swap to a cheaper vehicle releases nothing');
        Contract.Get(ContractNo);
        Assert.AreEqual('HX132-9-OLD', Contract."Payment Auth Code", 'The contract keeps its hold');
        Assert.AreEqual(120, Contract."Authorized Amount", 'The contract keeps its authorized amount');
        AssertContractVehicle(ContractNo, 'HX132-9C', 3000);
    end;

    [Test]
    procedure EqualRateSwapKeepsHold()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Spy: Codeunit "HX132 Card Provider Spy";
        ContractNo: Code[20];
    begin
        Prepare();
        CreateVehicle('HX132-10V', 1000, 40, false);
        CreateVehicle('HX132-10E', 3000, 40, false);
        ContractNo := CreateContract('HX132-10V');
        SeedCheckedOut(ContractNo, 'HX132-10V', 'HX132-10-OLD', 120);
        Spy.Init('HX132-10');
        BindSubscription(Spy);

        RentalMgt.SwapVehicle(ContractNo, 'HX132-10E');

        Assert.AreEqual(0, Spy.RequestCount(), 'A swap to a vehicle with the same rate places no hold');
        Assert.AreEqual(0, Spy.ReleaseCount(), 'A swap to a vehicle with the same rate releases nothing');
        Contract.Get(ContractNo);
        Assert.AreEqual('HX132-10-OLD', Contract."Payment Auth Code", 'The contract keeps its hold');
        Assert.AreEqual(120, Contract."Authorized Amount", 'The contract keeps its authorized amount');
        AssertContractVehicle(ContractNo, 'HX132-10E', 3000);
    end;

    [Test]
    procedure RetargetedSwapRequestsNewHold()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Spy: Codeunit "HX132 Card Provider Spy";
        ContractNo: Code[20];
        LastHold: Integer;
    begin
        Prepare();
        CreateVehicle('HX132-11V', 1000, 40, false);
        CreateVehicle('HX132-11N', 2500, 70, true);
        CreateVehicle('HX132-11M', 3500, 90, false);
        ContractNo := CreateContract('HX132-11V');
        SeedCheckedOut(ContractNo, 'HX132-11V', 'HX132-11-OLD', 120);
        Spy.Init('HX132-11');
        BindSubscription(Spy);
        Commit();
        asserterror RentalMgt.SwapVehicle(ContractNo, 'HX132-11N');
        Assert.ExpectedError(StrSubstNo(NotAvailableTxt, 'HX132-11N'));
        Assert.IsTrue(Spy.RequestCount() <= 1, 'A failed swap places at most one hold');

        RentalMgt.SwapVehicle(ContractNo, 'HX132-11M');

        LastHold := Spy.RequestCount();
        Assert.IsTrue(LastHold >= 1, 'A swap to a vehicle with another price places a hold');
        Assert.AreEqual(270, Spy.IssuedAmount(LastHold), 'The last hold is for the amount of the vehicle swapped to');
        Assert.AreEqual(1, Spy.TimesReleased('HX132-11-OLD'), 'The old hold is released exactly once');
        Assert.AreEqual(0, Spy.TimesReleased(Spy.IssuedCode(LastHold)), 'The hold the contract now carries is not released');
        Contract.Get(ContractNo);
        Assert.AreEqual(Spy.IssuedCode(LastHold), Contract."Payment Auth Code", 'The contract carries the hold for the new amount');
        Assert.AreEqual(270, Contract."Authorized Amount", 'The contract carries the new amount');
        AssertContractVehicle(ContractNo, 'HX132-11M', 3500);
        AssertVehicleCheckedOut('HX132-11V', false);
        AssertVehicleCheckedOut('HX132-11N', false);
        AssertVehicleCheckedOut('HX132-11M', true);
    end;

    [Test]
    procedure CheckOutAfterRateChangeRequestsNewHold()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Spy: Codeunit "HX132 Card Provider Spy";
        ContractNo: Code[20];
    begin
        Prepare();
        CreateVehicle('HX132-12V', 1000, 40, false);
        ContractNo := CreateContract('HX132-12V');
        Contract.Get(ContractNo);
        Contract."Payment Auth Code" := 'HX132-12-STALE';
        Contract."Authorized Amount" := 100;
        Contract.Modify();
        Spy.Init('HX132-12');
        BindSubscription(Spy);

        RentalMgt.CheckOut(ContractNo);

        Assert.AreEqual(1, Spy.RequestCount(), 'A hold for another amount is not reused');
        Assert.AreEqual(120, Spy.IssuedAmount(1), 'The new hold is for the expected amount');
        Assert.AreEqual(1, Spy.RequestsBeforeKeyBox(1), 'The card is authorized before the keys are handed out');
        Contract.Get(ContractNo);
        Assert.AreEqual(Spy.IssuedCode(1), Contract."Payment Auth Code", 'The contract carries the new hold');
        Assert.AreEqual(120, Contract."Authorized Amount", 'The contract carries the expected amount');
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'The contract is checked out');
        AssertVehicleCheckedOut('HX132-12V', true);
    end;

    [Test]
    procedure RetargetedSwapLeavesOneOpenHold()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Spy: Codeunit "HX132 Card Provider Spy";
        ContractNo: Code[20];
        i: Integer;
        OpenHolds: Integer;
    begin
        Prepare();
        CreateVehicle('HX132-13V', 1000, 40, false);
        CreateVehicle('HX132-13N', 2500, 70, true);
        CreateVehicle('HX132-13M', 3500, 90, false);
        ContractNo := CreateContract('HX132-13V');
        SeedCheckedOut(ContractNo, 'HX132-13V', 'HX132-13-OLD', 120);
        Spy.Init('HX132-13');
        BindSubscription(Spy);
        Commit();
        asserterror RentalMgt.SwapVehicle(ContractNo, 'HX132-13N');
        Assert.ExpectedError(StrSubstNo(NotAvailableTxt, 'HX132-13N'));

        RentalMgt.SwapVehicle(ContractNo, 'HX132-13M');

        for i := 1 to Spy.RequestCount() do
            if Spy.TimesReleased(Spy.IssuedCode(i)) = 0 then
                OpenHolds += 1;
        Assert.AreEqual(1, OpenHolds, 'Every hold the provider returned is released or carried by the contract: exactly one stays open');
        Assert.AreEqual(1, Spy.TimesReleased('HX132-13-OLD'), 'The old hold is released exactly once');
        Contract.Get(ContractNo);
        Assert.AreEqual(0, Spy.TimesReleased(Contract."Payment Auth Code"), 'The hold the contract carries stays open');
        Assert.AreEqual(270, Contract."Authorized Amount", 'The contract carries the amount of the vehicle swapped to');
    end;

    [Test]
    procedure CheaperSwapAfterFailedSwapReleasesUnusedHold()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Spy: Codeunit "HX132 Card Provider Spy";
        ContractNo: Code[20];
    begin
        Prepare();
        CreateVehicle('HX132-15V', 1000, 40, false);
        CreateVehicle('HX132-15N', 2500, 70, false);
        CreateVehicle('HX132-15C', 4000, 20, false);
        ContractNo := CreateContract('HX132-15V');
        SeedCheckedOut(ContractNo, 'HX132-15V', 'HX132-15-OLD', 120);
        Spy.Init('HX132-15');
        Spy.SetRefuseKeys(true);
        BindSubscription(Spy);
        Commit();
        asserterror RentalMgt.SwapVehicle(ContractNo, 'HX132-15N');
        Assert.ExpectedError(Spy.RefusalText(ContractNo));

        Spy.SetRefuseKeys(false);
        RentalMgt.SwapVehicle(ContractNo, 'HX132-15C');

        Assert.AreEqual(1, Spy.RequestCount(), 'The cheaper swap places no hold of its own');
        Assert.AreEqual(1, Spy.TimesReleased(Spy.IssuedCode(1)), 'The hold placed for the failed swap is released, not lost');
        Assert.AreEqual(0, Spy.TimesReleased('HX132-15-OLD'), 'The hold that covers the cheaper vehicle stays');
        Contract.Get(ContractNo);
        Assert.AreEqual('HX132-15-OLD', Contract."Payment Auth Code", 'The contract keeps its hold');
        Assert.AreEqual(120, Contract."Authorized Amount", 'The contract keeps its amount');
        AssertContractVehicle(ContractNo, 'HX132-15C', 4000);
    end;

    [Test]
    procedure RateChangedCheckOutReleasesReplacedHold()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Spy: Codeunit "HX132 Card Provider Spy";
        ContractNo: Code[20];
    begin
        Prepare();
        CreateVehicle('HX132-14V', 1000, 40, false);
        ContractNo := CreateContract('HX132-14V');
        Contract.Get(ContractNo);
        Contract."Payment Auth Code" := 'HX132-14-STALE';
        Contract."Authorized Amount" := 100;
        Contract.Modify();
        Spy.Init('HX132-14');
        BindSubscription(Spy);
        Commit();

        RentalMgt.CheckOut(ContractNo);

        Assert.AreEqual(1, Spy.RequestCount(), 'A hold for another amount is not reused');
        Assert.AreEqual(1, Spy.TimesReleased('HX132-14-STALE'), 'The hold the contract no longer carries is released, not lost');
        Assert.AreEqual(0, Spy.TimesReleased(Spy.IssuedCode(1)), 'The new hold stays open');
        Contract.Get(ContractNo);
        Assert.AreEqual(Spy.IssuedCode(1), Contract."Payment Auth Code", 'The contract carries the new hold');
    end;

    local procedure Prepare()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := 0;
        Setup."Km Allowance per Day" := 0;
        Setup."Excess Km Rate" := 0;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure CreateVehicle(VehicleNo: Code[20]; Mileage: Integer; DailyRate: Decimal; IsBlocked: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
    begin
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := Mileage;
        Vehicle."Daily Rate" := DailyRate;
        Vehicle.Blocked := IsBlocked;
        Vehicle.Insert();
    end;

    local procedure CreateContract(VehicleNo: Code[20]): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        exit(RentalMgt.CreateContract(VehicleNo, 'HX132 Customer', 20270301D, 20270303D));
    end;

    local procedure SeedCheckedOut(ContractNo: Code[20]; VehicleNo: Code[20]; AuthCode: Text[50]; Amount: Decimal)
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        Vehicle."Checked Out" := true;
        Vehicle.Modify();
        Contract.Get(ContractNo);
        Contract.Status := Contract.Status::"Checked Out";
        Contract."Start Km" := Vehicle.Mileage;
        Contract."Payment Auth Code" := AuthCode;
        Contract."Authorized Amount" := Amount;
        Contract.Modify();
    end;

    local procedure SetBlocked(VehicleNo: Code[20]; IsBlocked: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        Vehicle.Blocked := IsBlocked;
        Vehicle.Modify();
    end;

    local procedure AssertContractVehicle(ContractNo: Code[20]; VehicleNo: Code[20]; StartKm: Integer)
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.Get(ContractNo);
        Assert.AreEqual(VehicleNo, Contract."Vehicle No.", 'Contract vehicle');
        Assert.AreEqual(StartKm, Contract."Start Km", 'Contract start km');
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'The contract stays checked out');
    end;

    local procedure AssertVehicleCheckedOut(VehicleNo: Code[20]; Expected: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        Assert.AreEqual(Expected, Vehicle."Checked Out", StrSubstNo('Vehicle %1 checked out', VehicleNo));
    end;
}
