codeunit 80117 "CGR Numbering Naive"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure NumbersCarryTheirSeriesPrefix()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        RentalNo: Code[20];
        LeaseNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('HX065-N01', 1000, Enum::"CGR Maintenance Strategy"::Default);

        RentalNo := RentalMgt.CreateContract('HX065-N01', 'Numbering Customer', 20270301D, 20270303D);
        LeaseNo := LeaseMgt.CreateContract('HX065-N01', 'Numbering Customer', 20270301D, 6, 100);

        Assert.AreEqual('RC', CopyStr(RentalNo, 1, 2), 'Rental contract numbers start with RC');
        Assert.AreEqual('LC', CopyStr(LeaseNo, 1, 2), 'Lease numbers start with LC');
    end;
}
