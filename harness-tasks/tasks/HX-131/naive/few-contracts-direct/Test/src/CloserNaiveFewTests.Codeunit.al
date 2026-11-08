codeunit 80173 "CGR Closer Naive Few Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure NeverAsksWhenClosingContracts()
    var
        Contract: Record "CGR Rental Contract";
        ContractCloser: Codeunit "CGR Contract Closer";
        Index: Integer;
    begin
        HX131FewPrepare();
        for Index := 201 to 203 do
            HX131FewContract(StrSubstNo('HX131-NM%1', Index), 20250410D);

        Commit();
        Assert.AreEqual(3, ContractCloser.CloseExpired(20250415D), 'All 3 expired contracts are closed');
        Contract.SetFilter("Vehicle No.", 'HX131-NM*');
        Contract.SetRange(Status, Contract.Status::Closed);
        Assert.AreEqual(3, Contract.Count(), 'All 3 contracts are closed');
    end;

    [Test]
    procedure ClosesBeforeAsOfOnly()
    var
        Contract: Record "CGR Rental Contract";
        ContractCloser: Codeunit "CGR Contract Closer";
        EndedNo: Code[20];
        EndsOnAsOfNo: Code[20];
    begin
        HX131FewPrepare();
        EndedNo := HX131FewContract('HX131-NA1', 20250410D);
        EndsOnAsOfNo := HX131FewContract('HX131-NA2', 20250415D);

        Commit();
        Assert.AreEqual(1, ContractCloser.CloseExpired(20250415D), 'One contract ended before AsOf');
        Contract.Get(EndedNo);
        Assert.AreEqual(Contract.Status::Closed, Contract.Status, 'Expired contract closed');
        Assert.AreEqual(20250415D, Contract."Closed On", 'Closed On is AsOf');
        Contract.Get(EndsOnAsOfNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Contract ending on AsOf stays returned');
    end;

    [Test]
    procedure RefusedContractIsLogged()
    var
        Contract: Record "CGR Rental Contract";
        Failure: Record "CGR Close Failure";
        Spy: Codeunit "CGR Closer Naive Few Spy";
        ContractCloser: Codeunit "CGR Contract Closer";
        GoodNo: Code[20];
        RefusedNo: Code[20];
        Closed: Integer;
    begin
        HX131FewPrepare();
        GoodNo := HX131FewContract('HX131-NR1', 20250410D);
        RefusedNo := HX131FewContract('HX131-NR2', 20250410D);
        Spy.RefuseFewClosing(RefusedNo);
        BindSubscription(Spy);

        Commit();
        Closed := ContractCloser.CloseExpired(20250415D);
        UnbindSubscription(Spy);

        Assert.AreEqual(1, Closed, 'Only the good contract is closed');
        Contract.Get(GoodNo);
        Assert.AreEqual(Contract.Status::Closed, Contract.Status, 'Good contract closed');
        Contract.Get(RefusedNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Refused contract not closed');
        Failure.SetRange("Contract No.", RefusedNo);
        Assert.IsTrue(Failure.FindFirst(), 'A failure row is logged');
        Assert.AreEqual(Spy.FewRefusalText(RefusedNo), Failure."Error Text", 'The failure row has the error text');
    end;

    [Test]
    procedure PendingChangeIsCommitted()
    var
        Contract: Record "CGR Rental Contract";
        ContractCloser: Codeunit "CGR Contract Closer";
        ContractNo: Code[20];
    begin
        HX131FewPrepare();
        ContractNo := HX131FewContract('HX131-NP1', 20250410D);
        Commit();
        Contract.Get(ContractNo);
        Contract."Customer Name" := 'HX131 Naive Customer';
        Contract.Modify();

        Assert.AreEqual(1, ContractCloser.CloseExpired(20250415D), 'The contract is closed');
        Contract.Get(ContractNo);
        Assert.AreEqual('HX131 Naive Customer', Contract."Customer Name", 'The pending change is kept');
    end;

    local procedure HX131FewPrepare()
    var
        Contract: Record "CGR Rental Contract";
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        Contract.SetRange(Status, Contract.Status::Returned);
        Contract.SetFilter("End Date", '..%1', 20250415D);
        Contract.DeleteAll();
    end;

    local procedure HX131FewContract(VehicleNo: Code[20]; EndDate: Date): Code[20]
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        exit(Lib.CreateReturnedContract(VehicleNo, EndDate - 3, EndDate, 1100));
    end;
}
