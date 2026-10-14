codeunit 80117 "CGR Numbering Naive"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure NumbersContinueFromTheCounters()
    var
        Setup: Record "CGR Setup";
        RentalMgt: Codeunit "CGR Rental Mgt";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        RentalNo: Code[20];
        LeaseNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('HX065-N01', 1000, Enum::"CGR Maintenance Strategy"::Default);
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

        RentalNo := RentalMgt.CreateContract('HX065-N01', 'Numbering Customer', 20270301D, 20270303D);
        LeaseNo := LeaseMgt.CreateContract('HX065-N01', 'Numbering Customer', 20270301D, 6, 100);

        Assert.AreEqual('RC42', RentalNo, 'The rental contract number continues the rental series');
        Assert.AreEqual('LC8', LeaseNo, 'The lease number continues the lease series');
        Setup.Get();
        Assert.AreEqual(42, Setup."Last Contract No.", 'Last Contract No. is stored');
        Assert.AreEqual(8, Setup."Last Lease No.", 'Last Lease No. is stored');
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
