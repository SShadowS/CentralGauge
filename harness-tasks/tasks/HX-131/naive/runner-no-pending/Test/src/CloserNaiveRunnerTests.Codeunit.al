codeunit 80177 "CGR Closer Naive Runner Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure ManyContractsCloseUnattended()
    var
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "CGR Closer Naive Runner";
        Index: Integer;
        Ok: Boolean;
    begin
        HX131RunnerPrepare();
        for Index := 401 to 421 do
            HX131RunnerContract(StrSubstNo('HX131-UM%1', Index), 20250410D);
        Runner.SetAsOf(20250415D);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The closer runs unattended: ' + GetLastErrorText());
        Assert.AreEqual(21, Runner.ClosedInRun(), 'All 21 expired contracts are closed');
        Contract.SetFilter("Vehicle No.", 'HX131-UM*');
        Contract.SetRange(Status, Contract.Status::Closed);
        Assert.AreEqual(21, Contract.Count(), 'All 21 contracts are closed');
    end;

    [Test]
    procedure ClosesBeforeAsOfOnlyThroughRunner()
    var
        Contract: Record "CGR Rental Contract";
        ContractCloser: Codeunit "CGR Contract Closer";
        EndedNo: Code[20];
        EndsOnAsOfNo: Code[20];
    begin
        HX131RunnerPrepare();
        EndedNo := HX131RunnerContract('HX131-UA1', 20250410D);
        EndsOnAsOfNo := HX131RunnerContract('HX131-UA2', 20250415D);

        Commit();
        Assert.AreEqual(1, ContractCloser.CloseExpired(20250415D), 'One contract ended before AsOf');
        Contract.Get(EndedNo);
        Assert.AreEqual(Contract.Status::Closed, Contract.Status, 'Expired contract closed');
        Assert.AreEqual(20250415D, Contract."Closed On", 'Closed On is AsOf');
        Contract.Get(EndsOnAsOfNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Contract ending on AsOf stays returned');
    end;

    [Test]
    procedure RefusedMiddleContractThroughRunner()
    var
        Contract: Record "CGR Rental Contract";
        Failure: Record "CGR Close Failure";
        Spy: Codeunit "CGR Closer Naive Runner Spy";
        Runner: Codeunit "CGR Closer Naive Runner";
        CloseOrder: List of [Code[20]];
        RefusedNo: Code[20];
        Ok: Boolean;
    begin
        HX131RunnerPrepare();
        HX131RunnerContract('HX131-UR1', 20250410D);
        HX131RunnerContract('HX131-UR2', 20250410D);
        HX131RunnerContract('HX131-UR3', 20250410D);
        Contract.SetRange(Status, Contract.Status::Returned);
        Contract.SetFilter("End Date", '..%1', 20250414D);
        Contract.FindSet();
        repeat
            CloseOrder.Add(Contract."No.");
        until Contract.Next() = 0;
        RefusedNo := CloseOrder.Get(2);
        Spy.RefuseRunnerClosing(RefusedNo);
        BindSubscription(Spy);
        Runner.SetAsOf(20250415D);

        Commit();
        Ok := Runner.Run();
        UnbindSubscription(Spy);

        Assert.IsTrue(Ok, 'The closer finishes: ' + GetLastErrorText());
        Assert.AreEqual(2, Runner.ClosedInRun(), 'Two contracts are closed');
        Contract.Reset();
        Contract.Get(CloseOrder.Get(1));
        Assert.AreEqual(Contract.Status::Closed, Contract.Status, 'First contract closed');
        Contract.Get(CloseOrder.Get(3));
        Assert.AreEqual(Contract.Status::Closed, Contract.Status, 'Third contract closed');
        Contract.Get(RefusedNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Refused contract not closed');
        Assert.AreEqual('', Contract."Damage Description", 'Refused contract keeps nothing');
        Failure.SetRange("Contract No.", RefusedNo);
        Assert.IsTrue(Failure.FindFirst(), 'A failure row is logged');
        Assert.AreEqual(Spy.RunnerRefusalText(RefusedNo), Failure."Error Text", 'The failure row has the error text');
    end;

    [Test]
    procedure CommittedChangeBeforeRunIsKept()
    var
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "CGR Closer Naive Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        HX131RunnerPrepare();
        ContractNo := HX131RunnerContract('HX131-UP1', 20250410D);
        Contract.Get(ContractNo);
        Contract."Customer Name" := 'HX131 Runner Customer';
        Contract.Modify();
        Runner.SetAsOf(20250415D);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The closer runs: ' + GetLastErrorText());
        Assert.AreEqual(1, Runner.ClosedInRun(), 'The contract is closed');
        Contract.Get(ContractNo);
        Assert.AreEqual('HX131 Runner Customer', Contract."Customer Name", 'The change is kept');
    end;

    local procedure HX131RunnerPrepare()
    var
        Contract: Record "CGR Rental Contract";
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        Contract.SetRange(Status, Contract.Status::Returned);
        Contract.SetFilter("End Date", '..%1', 20250415D);
        Contract.DeleteAll();
    end;

    local procedure HX131RunnerContract(VehicleNo: Code[20]; EndDate: Date): Code[20]
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        exit(Lib.CreateReturnedContract(VehicleNo, EndDate - 3, EndDate, 1100));
    end;
}
