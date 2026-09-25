codeunit 85300 "HX004 Revenue Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure RentalRevenueSumsPostedContracts()
    begin
        Prepare();
        MakeVehicle('HX4-A');
        MakeVehicle('HX4-B');
        PostedRental('HX4-A', 20270301D, 20270303D);
        PostedRental('HX4-A', 20270308D, 20270309D);
        PostedRental('HX4-B', 20270301D, 20270304D);
        Assert.AreEqual(250.00, RentalRevenue('HX4-A', 0D, 0D), 'Rental revenue sums the posted contracts of the vehicle');
        Assert.AreEqual(200.00, RentalRevenue('HX4-B', 0D, 0D), 'Rental revenue of another vehicle is separate');
    end;

    [Test]
    procedure RentalRevenueDateFilterInclusive()
    begin
        Prepare();
        MakeVehicle('HX4-C');
        PostedRental('HX4-C', 20270301D, 20270303D);
        PostedRental('HX4-C', 20270308D, 20270309D);
        Assert.AreEqual(250.00, RentalRevenue('HX4-C', 20270303D, 20270309D), 'Both posting dates inside the filter');
        Assert.AreEqual(0, RentalRevenue('HX4-C', 20270304D, 20270308D), 'No posting date inside the filter');
        Assert.AreEqual(150.00, RentalRevenue('HX4-C', 20270303D, 20270303D), 'Filter on a single posting date');
    end;

    [Test]
    procedure RentalRevenueIgnoresUnposted()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Prepare();
        MakeVehicle('HX4-D');
        PostedRental('HX4-D', 20270301D, 20270303D);
        ContractNo := RentalMgt.CreateContract('HX4-D', 'Oracle Customer', 20270308D, 20270309D);
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1000, '');
        Assert.AreEqual(150.00, RentalRevenue('HX4-D', 0D, 0D), 'A returned contract that is not posted earns nothing yet');
    end;

    [Test]
    procedure LeaseRevenueCountsInvoicedLinesOnly()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseNo: Code[20];
    begin
        Prepare();
        MakeVehicle('HX4-E');
        LeaseNo := NewLease('HX4-E');
        LeaseMgt.InvoiceLine(LeaseNo, 10000);
        LeaseMgt.InvoiceLine(LeaseNo, 20000);
        Assert.AreEqual(206.00, LeaseRevenue('HX4-E', 0D, 0D), 'Only invoiced lease lines count');
    end;

    [Test]
    procedure LeaseRevenueDateFilterInclusive()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseNo: Code[20];
    begin
        Prepare();
        MakeVehicle('HX4-F');
        LeaseNo := NewLease('HX4-F');
        LeaseMgt.InvoiceLine(LeaseNo, 10000);
        LeaseMgt.InvoiceLine(LeaseNo, 20000);
        LeaseMgt.InvoiceLine(LeaseNo, 30000);
        Assert.AreEqual(103.00, LeaseRevenue('HX4-F', 20270401D, 20270401D), 'Filter on a single due date');
        Assert.AreEqual(309.00, LeaseRevenue('HX4-F', 20270301D, 20270501D), 'First and last due dates are inside the filter');
        Assert.AreEqual(0, LeaseRevenue('HX4-F', 20270302D, 20270331D), 'No due date inside the filter');
    end;

    [Test]
    procedure UninvoicedLinesFollowVehicleChange()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseNo: Code[20];
    begin
        Prepare();
        MakeVehicle('HX4-G');
        MakeVehicle('HX4-H');
        LeaseNo := NewLease('HX4-G');
        LeaseMgt.InvoiceLine(LeaseNo, 10000);
        ChangeLeaseVehicle(LeaseNo, 'HX4-H');
        Assert.AreEqual(103.00, LeaseRevenue('HX4-G', 0D, 0D), 'The invoiced line stays with the old vehicle');
        Assert.AreEqual(0, LeaseRevenue('HX4-H', 0D, 0D), 'Moved lines are not invoiced yet');
        LeaseMgt.InvoiceLine(LeaseNo, 20000);
        Assert.AreEqual(103.00, LeaseRevenue('HX4-G', 0D, 0D), 'Old vehicle after the second invoice');
        Assert.AreEqual(103.00, LeaseRevenue('HX4-H', 0D, 0D), 'The second installment is invoiced on the new vehicle');
        LeaseMgt.InvoiceLine(LeaseNo, 30000);
        Assert.AreEqual(103.00, LeaseRevenue('HX4-G', 0D, 0D), 'Old vehicle after the third invoice');
        Assert.AreEqual(206.00, LeaseRevenue('HX4-H', 0D, 0D), 'The third installment is invoiced on the new vehicle');
    end;

    [Test]
    procedure RepeatedVehicleChangeFollowsLastVehicle()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseNo: Code[20];
    begin
        Prepare();
        MakeVehicle('HX4-I');
        MakeVehicle('HX4-J');
        MakeVehicle('HX4-K');
        LeaseNo := NewLease('HX4-I');
        LeaseMgt.InvoiceLine(LeaseNo, 10000);
        ChangeLeaseVehicle(LeaseNo, 'HX4-J');
        ChangeLeaseVehicle(LeaseNo, 'HX4-K');
        LeaseMgt.InvoiceLine(LeaseNo, 20000);
        LeaseMgt.InvoiceLine(LeaseNo, 30000);
        Assert.AreEqual(103.00, LeaseRevenue('HX4-I', 0D, 0D), 'The first vehicle keeps its invoiced line');
        Assert.AreEqual(0, LeaseRevenue('HX4-J', 0D, 0D), 'The intermediate vehicle earns nothing');
        Assert.AreEqual(206.00, LeaseRevenue('HX4-K', 0D, 0D), 'The last vehicle earns the lines invoiced after the changes');
    end;

    [Test]
    procedure RevenueSourcesStaySeparate()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseNo: Code[20];
    begin
        Prepare();
        MakeVehicle('HX4-L');
        PostedRental('HX4-L', 20270301D, 20270303D);
        LeaseNo := NewLease('HX4-L');
        LeaseMgt.InvoiceLine(LeaseNo, 10000);
        Assert.AreEqual(150.00, RentalRevenue('HX4-L', 0D, 0D), 'Rental revenue counts rentals only');
        Assert.AreEqual(103.00, LeaseRevenue('HX4-L', 0D, 0D), 'Lease revenue counts leases only');
    end;

    [Test]
    procedure LineVehicleMovesAtValidation()
    var
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseNo: Code[20];
    begin
        Prepare();
        MakeVehicle('HX4-M');
        MakeVehicle('HX4-N');
        LeaseNo := NewLease('HX4-M');
        LeaseMgt.InvoiceLine(LeaseNo, 10000);
        ChangeLeaseVehicle(LeaseNo, 'HX4-N');
        Line.Get(LeaseNo, 10000);
        Assert.AreEqual('HX4-M', Line."Vehicle No.", 'The invoiced line keeps the vehicle it was invoiced on');
        Line.Get(LeaseNo, 20000);
        Assert.AreEqual('HX4-N', Line."Vehicle No.", 'An uninvoiced line moves to the new vehicle when the lease vehicle is validated');
        Line.Get(LeaseNo, 30000);
        Assert.AreEqual('HX4-N', Line."Vehicle No.", 'Every uninvoiced line moves to the new vehicle');
    end;

    local procedure Prepare()
    var
        Setup: Record "CGR Setup";
    begin
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := 0;
        Setup."Km Allowance per Day" := 1000;
        Setup."Excess Km Rate" := 0;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
    end;

    local procedure MakeVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Contract: Record "CGR Rental Contract";
        Entry: Record "CGR Rental Ledger Entry";
        Lease: Record "CGR Lease Contract";
        Line: Record "CGR Lease Schedule Line";
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        Lease.SetRange("Vehicle No.", VehicleNo);
        if Lease.FindSet() then
            repeat
                Line.SetRange("Contract No.", Lease."No.");
                Line.DeleteAll();
            until Lease.Next() = 0;
        Lease.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle."Daily Rate" := 50;
        Vehicle.Insert();
    end;

    local procedure PostedRental(VehicleNo: Code[20]; StartDate: Date; EndDate: Date)
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'Oracle Customer', StartDate, EndDate);
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1000, '');
        RentalMgt.Post(ContractNo);
    end;

    local procedure NewLease(VehicleNo: Code[20]): Code[20]
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseNo: Code[20];
    begin
        LeaseNo := LeaseMgt.CreateContract(VehicleNo, 'Oracle Customer', 20270301D, 3, 100);
        LeaseMgt.CreateSchedule(LeaseNo);
        exit(LeaseNo);
    end;

    local procedure ChangeLeaseVehicle(LeaseNo: Code[20]; NewVehicleNo: Code[20])
    var
        Lease: Record "CGR Lease Contract";
    begin
        Lease.Get(LeaseNo);
        Lease.Validate("Vehicle No.", NewVehicleNo);
        Lease.Modify(true);
    end;

    local procedure RentalRevenue(VehicleNo: Code[20]; FromDate: Date; ToDate: Date): Decimal
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        if FromDate <> 0D then
            Vehicle.SetRange("Date Filter", FromDate, ToDate);
        Vehicle.CalcFields("Rental Revenue");
        exit(Vehicle."Rental Revenue");
    end;

    local procedure LeaseRevenue(VehicleNo: Code[20]; FromDate: Date; ToDate: Date): Decimal
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        if FromDate <> 0D then
            Vehicle.SetRange("Date Filter", FromDate, ToDate);
        Vehicle.CalcFields("Lease Revenue");
        exit(Vehicle."Lease Revenue");
    end;
}
