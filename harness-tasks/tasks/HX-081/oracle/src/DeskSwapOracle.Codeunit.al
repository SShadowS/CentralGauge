// Every procedure drops a last swap left by an earlier procedure before it starts and drops its own afterwards
// (single-instance state outlives a procedure); ForgetLastSwap runs through the runner there and its outcome is not
// asserted. Every runner call commits first. LastSwapContract is read through a fresh variable.
codeunit 87080 "HX081 Desk Swap Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        NoSwapTxt: Label 'There is no desk swap to undo.', Locked = true;

    [Test]
    procedure SwapThenUndo()
    var
        Swap1: Codeunit "CGR Desk Swap";
        ContractNo: Code[20];
    begin
        HX81Prepare();
        HX81Vehicle('HX081-1A', 1000);
        HX81Vehicle('HX081-1B', 2500);
        ContractNo := HX81RentedContract('HX081-1A');

        Swap1.SwapAtDesk(ContractNo, 'HX081-1B');

        Assert.AreEqual('HX081-1B', HX81VehicleOf(ContractNo), 'The desk swap moves the contract to the new vehicle');
        Assert.AreEqual(2500, HX81StartKm(ContractNo), 'Start km is the new vehicle''s mileage');
        Assert.IsFalse(HX81CheckedOut('HX081-1A'), 'The vehicle the contract left is released');
        Assert.IsTrue(HX81CheckedOut('HX081-1B'), 'The new vehicle is checked out');
        Assert.AreEqual(ContractNo, HX81LastContract(), 'The desk swap is the last swap');

        Assert.IsTrue(HX81Undo(), StrSubstNo('Undo through another variable succeeds: %1', GetLastErrorText()));

        Assert.AreEqual('HX081-1A', HX81VehicleOf(ContractNo), 'Undo moves the contract back to the vehicle it came from');
        Assert.AreEqual(1000, HX81StartKm(ContractNo), 'Start km is the earlier vehicle''s mileage again');
        Assert.IsTrue(HX81CheckedOut('HX081-1A'), 'The earlier vehicle is checked out again');
        Assert.IsFalse(HX81CheckedOut('HX081-1B'), 'The vehicle the undo left is released');
        Assert.AreEqual('', HX81LastContract(), 'After the undo there is no last swap');
        HX81Finish();
    end;

    [Test]
    procedure SwapRaisesEvent()
    var
        Partner: Codeunit "HX081 Swap Partner";
        Swap1: Codeunit "CGR Desk Swap";
        ContractNo: Code[20];
    begin
        HX81Prepare();
        HX81Vehicle('HX081-2A', 1000);
        HX81Vehicle('HX081-2B', 2500);
        ContractNo := HX81RentedContract('HX081-2A');
        BindSubscription(Partner);

        Swap1.SwapAtDesk(ContractNo, 'HX081-2B');

        Assert.AreEqual(1, Partner.HX81Calls(), 'The desk swap raises OnAfterDeskSwap once');
        Assert.AreEqual(ContractNo, Partner.HX81CallContract(1), 'The event carries the contract');
        Assert.AreEqual('HX081-2A', Partner.HX81CallOld(1), 'The event carries the vehicle the contract left');
        Assert.AreEqual('HX081-2B', Partner.HX81CallNew(1), 'The event carries the vehicle the contract moved to');
        Assert.AreEqual('HX081-2B', Partner.HX81CallDbVehicle(1), 'The event is raised after the contract is on the new vehicle');
        UnbindSubscription(Partner);
        HX81Finish();
    end;

    [Test]
    procedure UndoRaisesEvent()
    var
        Partner: Codeunit "HX081 Swap Partner";
        Swap1: Codeunit "CGR Desk Swap";
        ContractNo: Code[20];
    begin
        HX81Prepare();
        HX81Vehicle('HX081-3A', 1000);
        HX81Vehicle('HX081-3B', 2500);
        ContractNo := HX81RentedContract('HX081-3A');
        BindSubscription(Partner);

        Swap1.SwapAtDesk(ContractNo, 'HX081-3B');
        Assert.IsTrue(HX81Undo(), StrSubstNo('Undo succeeds: %1', GetLastErrorText()));

        Assert.AreEqual(2, Partner.HX81Calls(), 'The swap and the undo each raise OnAfterDeskSwap');
        Assert.AreEqual(ContractNo, Partner.HX81CallContract(2), 'The undo''s event carries the contract');
        Assert.AreEqual('HX081-3B', Partner.HX81CallOld(2), 'The undo''s event carries the vehicle the contract leaves');
        Assert.AreEqual('HX081-3A', Partner.HX81CallNew(2), 'The undo''s event carries the vehicle the contract returns to');
        Assert.AreEqual('HX081-3A', Partner.HX81CallDbVehicle(2), 'The undo''s event is raised after the contract is back on the earlier vehicle');
        UnbindSubscription(Partner);
        HX81Finish();
    end;

    [Test]
    procedure FailedSwapKeepsEarlierSwap()
    var
        Swap1: Codeunit "CGR Desk Swap";
        ContractNo: Code[20];
    begin
        HX81Prepare();
        HX81Vehicle('HX081-4A', 1000);
        HX81Vehicle('HX081-4B', 2500);
        HX81Vehicle('HX081-4X', 4000);
        HX81Block('HX081-4X');
        ContractNo := HX81RentedContract('HX081-4A');
        Swap1.SwapAtDesk(ContractNo, 'HX081-4B');

        Assert.IsFalse(HX81Swap(ContractNo, 'HX081-4X'), 'A swap to a blocked vehicle fails');
        Assert.AreEqual('Vehicle HX081-4X is not available.', GetLastErrorText(), 'The swap fails with SwapVehicle''s error');
        Assert.AreEqual('HX081-4B', HX81VehicleOf(ContractNo), 'The failed swap leaves the contract where it was');
        Assert.IsFalse(HX81CheckedOut('HX081-4X'), 'The failed swap checks out nothing');
        Assert.AreEqual(ContractNo, HX81LastContract(), 'The failed swap leaves the earlier swap as the last swap');

        Assert.IsTrue(HX81Undo(), StrSubstNo('The earlier swap can still be undone: %1', GetLastErrorText()));
        Assert.AreEqual('HX081-4A', HX81VehicleOf(ContractNo), 'Undo returns the contract to the vehicle of the earlier swap');
        Assert.IsFalse(HX81CheckedOut('HX081-4B'), 'Undo releases the vehicle of the earlier swap');
        HX81Finish();
    end;

    [Test]
    procedure RefusedSwapRecordsNothing()
    var
        Partner: Codeunit "HX081 Swap Partner";
        ContractNo: Code[20];
    begin
        HX81Prepare();
        HX81Vehicle('HX081-5A', 1000);
        HX81Vehicle('HX081-5B', 2500);
        ContractNo := HX81RentedContract('HX081-5A');
        Partner.HX81Refuse('HX081-5B');
        BindSubscription(Partner);

        Assert.IsFalse(HX81Swap(ContractNo, 'HX081-5B'), 'A swap the partner refuses fails');
        Assert.AreEqual('HX081 portal refused HX081-5B.', GetLastErrorText(), 'The swap fails with the partner''s error');
        Assert.AreEqual(1, Partner.HX81Calls(), 'Precondition: the partner was told about the swap');
        Assert.AreEqual('HX081-5A', HX81VehicleOf(ContractNo), 'The refused swap leaves the contract on its vehicle');
        Assert.IsTrue(HX81CheckedOut('HX081-5A'), 'The contract''s vehicle stays checked out');
        Assert.IsFalse(HX81CheckedOut('HX081-5B'), 'The refused swap checks out nothing');
        Assert.AreEqual('', HX81LastContract(), 'A refused swap is not the last swap');
        UnbindSubscription(Partner);
        HX81Finish();
    end;

    [Test]
    procedure RefusedSwapKeepsOtherContractsSwap()
    var
        Partner: Codeunit "HX081 Swap Partner";
        Swap1: Codeunit "CGR Desk Swap";
        ContractC: Code[20];
        ContractD: Code[20];
    begin
        HX81Prepare();
        HX81Vehicle('HX081-6A', 1000);
        HX81Vehicle('HX081-6B', 2500);
        HX81Vehicle('HX081-6E', 3000);
        HX81Vehicle('HX081-6F', 3500);
        ContractC := HX81RentedContract('HX081-6A');
        ContractD := HX81RentedContract('HX081-6E');
        Swap1.SwapAtDesk(ContractD, 'HX081-6F');
        Partner.HX81Refuse('HX081-6B');
        BindSubscription(Partner);

        Assert.IsFalse(HX81Swap(ContractC, 'HX081-6B'), 'A swap the partner refuses fails');
        Assert.AreEqual('HX081 portal refused HX081-6B.', GetLastErrorText(), 'The swap fails with the partner''s error');
        Assert.AreEqual(ContractD, HX81LastContract(), 'The refused swap leaves the other contract''s swap as the last swap');

        Assert.IsTrue(HX81Undo(), StrSubstNo('The other contract''s swap can still be undone: %1', GetLastErrorText()));
        Assert.AreEqual('HX081-6E', HX81VehicleOf(ContractD), 'Undo returns the other contract to its earlier vehicle');
        Assert.AreEqual('HX081-6A', HX81VehicleOf(ContractC), 'The refused contract stays on its vehicle');
        UnbindSubscription(Partner);
        HX81Finish();
    end;

    [Test]
    procedure FailedUndoKeepsSwap()
    var
        Swap1: Codeunit "CGR Desk Swap";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractC: Code[20];
        ContractK: Code[20];
    begin
        HX81Prepare();
        HX81Vehicle('HX081-7A', 1000);
        HX81Vehicle('HX081-7B', 2500);
        ContractC := HX81RentedContract('HX081-7A');
        Swap1.SwapAtDesk(ContractC, 'HX081-7B');
        ContractK := HX81RentedContract('HX081-7A');

        Assert.IsFalse(HX81Undo(), 'Undo fails while the earlier vehicle is rented out');
        Assert.AreEqual('Vehicle HX081-7A is not available.', GetLastErrorText(), 'The undo fails with SwapVehicle''s error');
        Assert.AreEqual('HX081-7B', HX81VehicleOf(ContractC), 'The failed undo leaves the contract on its vehicle');
        Assert.AreEqual(ContractC, HX81LastContract(), 'The failed undo keeps the last swap');

        RentalMgt.Return(ContractK, 1500, '');
        Assert.IsTrue(HX81Undo(), StrSubstNo('Undo succeeds once the earlier vehicle is back: %1', GetLastErrorText()));
        Assert.AreEqual('HX081-7A', HX81VehicleOf(ContractC), 'The kept swap is undone later');
        HX81Finish();
    end;

    [Test]
    procedure UndoWithoutSwap()
    begin
        HX81Prepare();
        Assert.AreEqual('', HX81LastContract(), 'Precondition: there is no last swap');

        Assert.IsFalse(HX81Undo(), 'Undo without a last swap fails');
        Assert.AreEqual(NoSwapTxt, GetLastErrorText(), 'Undo without a last swap fails with the no-swap error');
        HX81Finish();
    end;

    [Test]
    procedure SecondSwapReplaces()
    var
        Swap1: Codeunit "CGR Desk Swap";
        Swap2: Codeunit "CGR Desk Swap";
        ContractC: Code[20];
        ContractD: Code[20];
    begin
        HX81Prepare();
        HX81Vehicle('HX081-9A', 1000);
        HX81Vehicle('HX081-9B', 2500);
        HX81Vehicle('HX081-9E', 3000);
        HX81Vehicle('HX081-9F', 3500);
        ContractC := HX81RentedContract('HX081-9A');
        ContractD := HX81RentedContract('HX081-9E');

        Swap1.SwapAtDesk(ContractC, 'HX081-9B');
        Swap2.SwapAtDesk(ContractD, 'HX081-9F');

        Assert.AreEqual(ContractD, HX81LastContract(), 'The second desk swap replaces the first as the last swap');
        Assert.IsTrue(HX81Undo(), StrSubstNo('Undo succeeds: %1', GetLastErrorText()));
        Assert.AreEqual('HX081-9E', HX81VehicleOf(ContractD), 'Undo returns the second contract to its earlier vehicle');
        Assert.AreEqual('HX081-9B', HX81VehicleOf(ContractC), 'The first contract stays on its new vehicle');
        HX81Finish();
    end;

    [Test]
    procedure UndoOnlyOnce()
    var
        Swap1: Codeunit "CGR Desk Swap";
        ContractNo: Code[20];
    begin
        HX81Prepare();
        HX81Vehicle('HX081-10A', 1000);
        HX81Vehicle('HX081-10B', 2500);
        ContractNo := HX81RentedContract('HX081-10A');
        Swap1.SwapAtDesk(ContractNo, 'HX081-10B');

        Assert.IsTrue(HX81Undo(), StrSubstNo('Precondition: the first undo succeeds: %1', GetLastErrorText()));
        Assert.IsFalse(HX81Undo(), 'A second undo fails');
        Assert.AreEqual(NoSwapTxt, GetLastErrorText(), 'A second undo fails with the no-swap error');
        Assert.AreEqual('HX081-10A', HX81VehicleOf(ContractNo), 'The contract stays on the earlier vehicle');
        HX81Finish();
    end;

    [Test]
    procedure PlainSwapNotRemembered()
    var
        Partner: Codeunit "HX081 Swap Partner";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        HX81Prepare();
        HX81Vehicle('HX081-11A', 1000);
        HX81Vehicle('HX081-11B', 2500);
        ContractNo := HX81RentedContract('HX081-11A');
        BindSubscription(Partner);

        RentalMgt.SwapVehicle(ContractNo, 'HX081-11B');

        Assert.AreEqual('HX081-11B', HX81VehicleOf(ContractNo), 'Precondition: SwapVehicle moved the contract');
        Assert.AreEqual('', HX81LastContract(), 'A swap made with SwapVehicle is not a desk swap');
        Assert.AreEqual(0, Partner.HX81Calls(), 'A swap made with SwapVehicle raises no OnAfterDeskSwap');
        UnbindSubscription(Partner);
        HX81Finish();
    end;

    [Test]
    procedure ForgetDropsSwap()
    var
        Swap1: Codeunit "CGR Desk Swap";
        Swap2: Codeunit "CGR Desk Swap";
        ContractNo: Code[20];
    begin
        HX81Prepare();
        HX81Vehicle('HX081-12A', 1000);
        HX81Vehicle('HX081-12B', 2500);
        HX81Vehicle('HX081-12X', 3000);
        ContractNo := HX81RentedContract('HX081-12A');
        Swap1.SwapAtDesk(ContractNo, 'HX081-12B');
        Assert.AreEqual(ContractNo, HX81LastContract(), 'Precondition: the desk swap is the last swap');

        Swap2.ForgetLastSwap();
        Assert.AreEqual('', HX81LastContract(), 'ForgetLastSwap drops the last swap');
        Assert.IsTrue(HX81Forget(), StrSubstNo('ForgetLastSwap without a last swap does not fail: %1', GetLastErrorText()));
        Assert.IsFalse(HX81Undo(), 'Undo after ForgetLastSwap fails');
        Assert.AreEqual(NoSwapTxt, GetLastErrorText(), 'Undo after ForgetLastSwap fails with the no-swap error');
        Assert.AreEqual('HX081-12B', HX81VehicleOf(ContractNo), 'The forgotten swap is not undone');

        Assert.IsTrue(HX81Swap(ContractNo, 'HX081-12X'), StrSubstNo('A new desk swap succeeds after ForgetLastSwap: %1', GetLastErrorText()));
        Assert.AreEqual(ContractNo, HX81LastContract(), 'A new desk swap after ForgetLastSwap is the last swap');
        HX81Finish();
    end;

    [Test]
    procedure RefusedUndoKeepsSwap()
    var
        Partner: Codeunit "HX081 Swap Partner";
        Swap1: Codeunit "CGR Desk Swap";
        ContractNo: Code[20];
    begin
        HX81Prepare();
        HX81Vehicle('HX081-13A', 1000);
        HX81Vehicle('HX081-13B', 2500);
        ContractNo := HX81RentedContract('HX081-13A');
        Partner.HX81Refuse('HX081-13A');
        BindSubscription(Partner);
        Swap1.SwapAtDesk(ContractNo, 'HX081-13B');

        Assert.IsFalse(HX81Undo(), 'An undo the partner refuses fails');
        Assert.AreEqual('HX081 portal refused HX081-13A.', GetLastErrorText(), 'The undo fails with the partner''s error');
        Assert.AreEqual('HX081-13B', HX81VehicleOf(ContractNo), 'The refused undo leaves the contract on its vehicle');
        Assert.IsTrue(HX81CheckedOut('HX081-13B'), 'The contract''s vehicle stays checked out');
        Assert.IsFalse(HX81CheckedOut('HX081-13A'), 'The refused undo checks out nothing');
        Assert.AreEqual(ContractNo, HX81LastContract(), 'The refused undo keeps the last swap');
        UnbindSubscription(Partner);
        HX81Finish();
    end;

    [Test]
    procedure MissingContractFails()
    var
        Contract: Record "CGR Rental Contract";
    begin
        HX81Prepare();
        HX81Vehicle('HX081-14B', 2500);
        if Contract.Get('HX081-NONE') then
            Contract.Delete();

        Assert.IsFalse(HX81Swap('HX081-NONE', 'HX081-14B'), 'A swap of a missing contract fails');
        Assert.AreEqual('The CGR Rental Contract does not exist. Identification fields and values: No.=''HX081-NONE''', GetLastErrorText(), 'The not-found error reaches the caller');
        Assert.IsFalse(HX81CheckedOut('HX081-14B'), 'The failed swap checks out nothing');
        Assert.AreEqual('', HX81LastContract(), 'A failed swap of a missing contract is not the last swap');
        HX81Finish();
    end;

    local procedure HX81Prepare()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
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
        HX81Forget();
    end;

    local procedure HX81Finish()
    begin
        HX81Forget();
    end;

    local procedure HX81Forget(): Boolean
    var
        Runner: Codeunit "HX081 Desk Runner";
        Ok: Boolean;
    begin
        Runner.HX81SetForget();
        Commit();
        Ok := Runner.Run();
        Commit();
        exit(Ok);
    end;

    local procedure HX81Swap(ContractNo: Code[20]; VehicleNo: Code[20]): Boolean
    var
        Runner: Codeunit "HX081 Desk Runner";
    begin
        Runner.HX81SetSwap(ContractNo, VehicleNo);
        Commit();
        exit(Runner.Run());
    end;

    local procedure HX81Undo(): Boolean
    var
        Runner: Codeunit "HX081 Desk Runner";
    begin
        Runner.HX81SetUndo();
        Commit();
        exit(Runner.Run());
    end;

    local procedure HX81LastContract(): Code[20]
    var
        DeskSwap: Codeunit "CGR Desk Swap";
    begin
        exit(DeskSwap.LastSwapContract());
    end;

    local procedure HX81Vehicle(VehicleNo: Code[20]; Mileage: Integer)
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
        Vehicle.Mileage := Mileage;
        Vehicle.Strategy := Vehicle.Strategy::Default;
        Vehicle.Insert();
    end;

    local procedure HX81Block(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        Vehicle.Blocked := true;
        Vehicle."Open Damages" := 1;
        Vehicle.Modify();
    end;

    local procedure HX81RentedContract(VehicleNo: Code[20]): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX081', 20270301D, 20270303D);
        RentalMgt.CheckOut(ContractNo);
        exit(ContractNo);
    end;

    local procedure HX81VehicleOf(ContractNo: Code[20]): Code[20]
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.Get(ContractNo);
        exit(Contract."Vehicle No.");
    end;

    local procedure HX81StartKm(ContractNo: Code[20]): Integer
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.Get(ContractNo);
        exit(Contract."Start Km");
    end;

    local procedure HX81CheckedOut(VehicleNo: Code[20]): Boolean
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        exit(Vehicle."Checked Out");
    end;
}
