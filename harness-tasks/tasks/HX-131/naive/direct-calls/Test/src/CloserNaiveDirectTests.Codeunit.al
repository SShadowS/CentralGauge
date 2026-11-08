codeunit 80175 "CGR Closer Naive Direct Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure ClosesManyContractsWithoutAsking()
    var
        Contract: Record "CGR Rental Contract";
        ContractCloser: Codeunit "CGR Contract Closer";
        Index: Integer;
    begin
        HX131DirectPrepare();
        for Index := 301 to 321 do
            HX131DirectContract(StrSubstNo('HX131-DM%1', Index), 20250410D);

        Commit();
        Assert.AreEqual(21, ContractCloser.CloseExpired(20250415D), 'All 21 expired contracts are closed');
        Contract.SetFilter("Vehicle No.", 'HX131-DM*');
        Contract.SetRange(Status, Contract.Status::Closed);
        Assert.AreEqual(21, Contract.Count(), 'All 21 contracts are closed');
    end;

    [Test]
    procedure ClosesBeforeAsOfOnlyDirect()
    var
        Contract: Record "CGR Rental Contract";
        ContractCloser: Codeunit "CGR Contract Closer";
        EndedNo: Code[20];
        EndsOnAsOfNo: Code[20];
    begin
        HX131DirectPrepare();
        EndedNo := HX131DirectContract('HX131-DA1', 20250410D);
        EndsOnAsOfNo := HX131DirectContract('HX131-DA2', 20250415D);

        Commit();
        Assert.AreEqual(1, ContractCloser.CloseExpired(20250415D), 'One contract ended before AsOf');
        Contract.Get(EndedNo);
        Assert.AreEqual(Contract.Status::Closed, Contract.Status, 'Expired contract closed');
        Assert.AreEqual(20250415D, Contract."Closed On", 'Closed On is AsOf');
        Contract.Get(EndsOnAsOfNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Contract ending on AsOf stays returned');
    end;

    [Test]
    procedure RefusedContractIsLoggedDirect()
    var
        Contract: Record "CGR Rental Contract";
        Failure: Record "CGR Close Failure";
        Spy: Codeunit "CGR Closer Naive Direct Spy";
        ContractCloser: Codeunit "CGR Contract Closer";
        FirstNo: Code[20];
        SecondNo: Code[20];
        ThirdNo: Code[20];
        Closed: Integer;
    begin
        HX131DirectPrepare();
        FirstNo := HX131DirectContract('HX131-DR1', 20250410D);
        SecondNo := HX131DirectContract('HX131-DR2', 20250410D);
        ThirdNo := HX131DirectContract('HX131-DR3', 20250410D);
        Spy.RefuseDirectClosing(SecondNo);
        BindSubscription(Spy);

        Commit();
        Closed := ContractCloser.CloseExpired(20250415D);
        UnbindSubscription(Spy);

        Assert.AreEqual(2, Closed, 'Two contracts are closed');
        Contract.Get(FirstNo);
        Assert.AreEqual(Contract.Status::Closed, Contract.Status, 'First contract closed');
        Contract.Get(ThirdNo);
        Assert.AreEqual(Contract.Status::Closed, Contract.Status, 'Third contract closed');
        Contract.Get(SecondNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Refused contract not closed');
        Failure.SetRange("Contract No.", SecondNo);
        Assert.IsTrue(Failure.FindFirst(), 'A failure row is logged');
        Assert.AreEqual(Spy.DirectRefusalText(SecondNo), Failure."Error Text", 'The failure row has the error text');
    end;

    local procedure HX131DirectPrepare()
    var
        Contract: Record "CGR Rental Contract";
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        Contract.SetRange(Status, Contract.Status::Returned);
        Contract.SetFilter("End Date", '..%1', 20250415D);
        Contract.DeleteAll();
    end;

    local procedure HX131DirectContract(VehicleNo: Code[20]; EndDate: Date): Code[20]
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        exit(Lib.CreateReturnedContract(VehicleNo, EndDate - 3, EndDate, 1100));
    end;
}
