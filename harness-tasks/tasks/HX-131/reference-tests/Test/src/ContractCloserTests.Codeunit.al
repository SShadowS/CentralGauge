codeunit 80170 "CGR Contract Closer Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure ClosesOnlyReturnedContractsEndedBeforeAsOf()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractCloser: Codeunit "CGR Contract Closer";
        EndedNo: Code[20];
        EndsOnAsOfNo: Code[20];
        OpenNo: Code[20];
        Closed: Integer;
    begin
        HX131Prepare();
        EndedNo := HX131ReturnedContract('HX131-A1', 20250410D);
        EndsOnAsOfNo := HX131ReturnedContract('HX131-A2', 20250415D);
        Lib.CreateVehicle('HX131-A3', 1000, Enum::"CGR Maintenance Strategy"::Default);
        OpenNo := RentalMgt.CreateContract('HX131-A3', 'HX131 Customer', 20250407D, 20250410D);

        Commit();
        Closed := ContractCloser.CloseExpired(20250415D);

        Assert.AreEqual(1, Closed, 'Only the returned contract that ended before AsOf is closed');
        Contract.Get(EndedNo);
        Assert.AreEqual(Contract.Status::Closed, Contract.Status, 'An expired returned contract is closed');
        Assert.AreEqual(20250415D, Contract."Closed On", 'Closed On is AsOf');
        Contract.Get(EndsOnAsOfNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'A contract ending on AsOf is not closed');
        Assert.AreEqual(0D, Contract."Closed On", 'A contract ending on AsOf gets no closing date');
        Contract.Get(OpenNo);
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'An open contract is not changed');
    end;

    [Test]
    procedure NeverAsksWhenMoreThanTwentyContractsExpired()
    var
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "CGR Contract Closer Runner";
        Index: Integer;
        Ok: Boolean;
    begin
        HX131Prepare();
        for Index := 101 to 121 do
            HX131ReturnedContract(StrSubstNo('HX131-M%1', Index), 20250410D);
        Runner.SetCloseRun(20250415D, '', '');

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The closer runs unattended with 21 expired contracts: ' + GetLastErrorText());
        Assert.AreEqual(21, Runner.ClosedContracts(), 'All 21 expired contracts are closed');
        Contract.SetFilter("Vehicle No.", 'HX131-M*');
        Contract.SetRange(Status, Contract.Status::Closed);
        Assert.AreEqual(21, Contract.Count(), 'All 21 contracts have status Closed');
    end;

    [Test]
    procedure RefusedContractKeepsNothingAndOthersStayClosed()
    var
        Contract: Record "CGR Rental Contract";
        Failure: Record "CGR Close Failure";
        Spy: Codeunit "CGR Close Refusal Spy";
        Runner: Codeunit "CGR Contract Closer Runner";
        CloseOrder: List of [Code[20]];
        FirstNo: Code[20];
        RefusedNo: Code[20];
        LastNo: Code[20];
        Ok: Boolean;
    begin
        HX131Prepare();
        HX131ReturnedContract('HX131-R1', 20250410D);
        HX131ReturnedContract('HX131-R2', 20250410D);
        HX131ReturnedContract('HX131-R3', 20250410D);
        Contract.SetRange(Status, Contract.Status::Returned);
        Contract.SetFilter("End Date", '..%1', 20250414D);
        Contract.FindSet();
        repeat
            CloseOrder.Add(Contract."No.");
        until Contract.Next() = 0;
        Assert.AreEqual(3, CloseOrder.Count(), 'Three expired contracts are prepared');
        FirstNo := CloseOrder.Get(1);
        RefusedNo := CloseOrder.Get(2);
        LastNo := CloseOrder.Get(3);
        Spy.RefuseClosing(RefusedNo);
        BindSubscription(Spy);
        Runner.SetCloseRun(20250415D, '', '');

        Commit();
        Ok := Runner.Run();
        UnbindSubscription(Spy);

        Assert.IsTrue(Ok, 'The closer finishes although one contract is refused: ' + GetLastErrorText());
        Assert.AreEqual(2, Runner.ClosedContracts(), 'The result counts the closed contracts only');
        Contract.Reset();
        Contract.Get(FirstNo);
        Assert.AreEqual(Contract.Status::Closed, Contract.Status, 'The contract closed before the failure stays closed');
        Assert.AreEqual(20250415D, Contract."Closed On", 'Closed On of the first contract');
        Contract.Get(LastNo);
        Assert.AreEqual(Contract.Status::Closed, Contract.Status, 'The contract after the failure is still closed');
        Contract.Get(RefusedNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'The refused contract is not closed');
        Assert.AreEqual(0D, Contract."Closed On", 'The refused contract gets no closing date');
        Assert.AreEqual('', Contract."Damage Description", 'The refused contract keeps nothing of the attempt');
        Failure.SetRange("Contract No.", RefusedNo);
        Assert.AreEqual(1, Failure.Count(), 'One failure row records the refused contract');
        Failure.FindFirst();
        Assert.AreEqual(Spy.ClosingRefusalText(RefusedNo), Failure."Error Text", 'The failure row records the error text');
        Failure.SetFilter("Contract No.", '%1|%2', FirstNo, LastNo);
        Assert.AreEqual(0, Failure.Count(), 'Closed contracts get no failure row');
    end;

    [Test]
    procedure CallersUncommittedChangeIsCommittedFirst()
    var
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "CGR Contract Closer Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        HX131Prepare();
        ContractNo := HX131ReturnedContract('HX131-P1', 20250410D);
        Runner.SetCloseRun(20250415D, ContractNo, 'HX131 Renamed Customer');

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The closer works with an uncommitted change of its caller: ' + GetLastErrorText());
        Assert.AreEqual(1, Runner.ClosedContracts(), 'The expired contract is closed');
        Contract.Get(ContractNo);
        Assert.AreEqual('HX131 Renamed Customer', Contract."Customer Name", 'The caller''s change is stored');
        Assert.AreEqual(Contract.Status::Closed, Contract.Status, 'The contract is closed');
    end;

    local procedure HX131Prepare()
    var
        Contract: Record "CGR Rental Contract";
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        Contract.SetRange(Status, Contract.Status::Returned);
        Contract.SetFilter("End Date", '..%1', 20250415D);
        Contract.DeleteAll();
    end;

    local procedure HX131ReturnedContract(VehicleNo: Code[20]; EndDate: Date): Code[20]
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        exit(Lib.CreateReturnedContract(VehicleNo, EndDate - 3, EndDate, 1100));
    end;
}
