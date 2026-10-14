codeunit 80116 "CGR Numbering Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure BothSeriesContinueFromTheirOwnCounters()
    var
        Setup: Record "CGR Setup";
        RentalContract: Record "CGR Rental Contract";
        LeaseContract: Record "CGR Lease Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        RentalNo: Code[20];
        LeaseNo: Code[20];
    begin
        Initialize();
        DeleteRental('RC41');
        DeleteRental('RC42');
        DeleteRental('RC00042');
        DeleteRental('RC-42');
        DeleteLease('LC7');
        DeleteLease('LC8');
        DeleteLease('LC43');
        DeleteLease('LC00008');
        DeleteLease('LC-8');
        DeleteLease('RC8');
        Setup.Get();
        Setup."Last Contract No." := 41;
        Setup."Last Lease No." := 7;
        Setup.Modify();
        Setup.Get();
        Assert.AreEqual(41, Setup."Last Contract No.", 'Last Contract No. is 41 before the test');
        Assert.AreEqual(7, Setup."Last Lease No.", 'Last Lease No. is 7 before the test');

        RentalNo := RentalMgt.CreateContract('HX065-V01', 'Numbering Customer', 20270301D, 20270303D);
        LeaseNo := LeaseMgt.CreateContract('HX065-V01', 'Numbering Customer', 20270301D, 6, 100);

        Assert.AreEqual('RC42', RentalNo, 'The rental contract number continues the rental series');
        Assert.AreEqual('LC8', LeaseNo, 'The lease number continues the lease series');
        Assert.IsTrue(RentalContract.Get('RC42'), 'The rental contract is stored as RC42');
        Assert.IsTrue(LeaseContract.Get('LC8'), 'The lease is stored as LC8');
        Setup.Get();
        Assert.AreEqual(42, Setup."Last Contract No.", 'Only the rental contract moves Last Contract No.');
        Assert.AreEqual(8, Setup."Last Lease No.", 'Only the lease moves Last Lease No.');
    end;

    [Test]
    procedure NumberingStartsAtOneWithoutSetup()
    var
        Setup: Record "CGR Setup";
        RentalMgt: Codeunit "CGR Rental Mgt";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        RentalNo: Code[20];
        LeaseNo: Code[20];
    begin
        Initialize();
        DeleteRental('RC0');
        DeleteRental('RC1');
        DeleteRental('RC10');
        DeleteRental('RC00001');
        DeleteRental('RC-1');
        DeleteLease('LC0');
        DeleteLease('LC1');
        DeleteLease('LC2');
        DeleteLease('LC10');
        DeleteLease('LC00001');
        DeleteLease('LC-1');
        DeleteLease('RC1');
        Setup.DeleteAll();
        Assert.IsTrue(Setup.IsEmpty(), 'There is no CGR Setup record before the test');

        RentalNo := RentalMgt.CreateContract('HX065-V01', 'Numbering Customer', 20270301D, 20270303D);
        LeaseNo := LeaseMgt.CreateContract('HX065-V01', 'Numbering Customer', 20270301D, 6, 100);

        Assert.AreEqual('RC1', RentalNo, 'Without a setup the rental series starts at RC1');
        Assert.AreEqual('LC1', LeaseNo, 'Without a setup the lease series starts at LC1');
        Assert.IsTrue(Setup.Get(), 'Numbering creates the CGR Setup record');
        Assert.AreEqual(1, Setup."Last Contract No.", 'Last Contract No. is 1 after the first contract');
        Assert.AreEqual(1, Setup."Last Lease No.", 'Last Lease No. is 1 after the first lease');
    end;

    [Test]
    procedure LeaseFirstStartsAtOneWithoutSetup()
    var
        Setup: Record "CGR Setup";
        RentalMgt: Codeunit "CGR Rental Mgt";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        RentalNo: Code[20];
        LeaseNo: Code[20];
    begin
        Initialize();
        DeleteRental('RC0');
        DeleteRental('RC1');
        DeleteRental('RC2');
        DeleteRental('RC10');
        DeleteRental('RC00001');
        DeleteRental('RC-1');
        DeleteLease('LC0');
        DeleteLease('LC1');
        DeleteLease('LC10');
        DeleteLease('LC00001');
        DeleteLease('LC-1');
        DeleteLease('RC1');
        Setup.DeleteAll();
        Assert.IsTrue(Setup.IsEmpty(), 'There is no CGR Setup record before the test');

        LeaseNo := LeaseMgt.CreateContract('HX065-V01', 'Numbering Customer', 20270301D, 6, 100);

        Assert.AreEqual('LC1', LeaseNo, 'Without a setup the lease series starts at LC1');
        Assert.IsTrue(Setup.Get(), 'The first lease creates the CGR Setup record');
        Assert.AreEqual(1, Setup."Last Lease No.", 'Last Lease No. is 1 after the first lease');
        Assert.AreEqual(0, Setup."Last Contract No.", 'A lease does not move Last Contract No.');

        RentalNo := RentalMgt.CreateContract('HX065-V01', 'Numbering Customer', 20270301D, 20270303D);

        Assert.AreEqual('RC1', RentalNo, 'The rental series still starts at RC1 after a lease');
        Setup.Get();
        Assert.AreEqual(1, Setup."Last Contract No.", 'Last Contract No. is 1 after the first contract');
        Assert.AreEqual(1, Setup."Last Lease No.", 'A rental contract does not move Last Lease No.');
    end;

    local procedure Initialize()
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('HX065-V01', 1000, Enum::"CGR Maintenance Strategy"::Default);
    end;

    local procedure DeleteRental(ContractNo: Code[20])
    var
        RentalContract: Record "CGR Rental Contract";
    begin
        RentalContract.SetRange("No.", ContractNo);
        RentalContract.DeleteAll();
    end;

    local procedure DeleteLease(ContractNo: Code[20])
    var
        LeaseContract: Record "CGR Lease Contract";
    begin
        LeaseContract.SetRange("No.", ContractNo);
        LeaseContract.DeleteAll();
    end;
}
