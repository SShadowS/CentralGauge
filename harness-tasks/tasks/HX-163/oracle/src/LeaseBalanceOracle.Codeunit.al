codeunit 88405 "HX163 Lease Balance Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        LeaseBalance: Codeunit "CGR Lease Balance";

    [Test]
    procedure TwoLeasesOneVehicleSeparateRows()
    var
        Buffer: Record "CGR Lease Balance Buffer" temporary;
    begin
        SeedHX163Fixture();

        LeaseBalance.FillBalances(20270331D, Buffer);

        AssertHX163Row(Buffer, 'HX163-L1', 'HX163-V1', 200, 2, 'First lease on the shared vehicle');
        AssertHX163Row(Buffer, 'HX163-L2', 'HX163-V1', 250, 1, 'Second lease on the shared vehicle');
    end;

    [Test]
    procedure AmountAndCountStopAtAsOf()
    var
        Buffer: Record "CGR Lease Balance Buffer" temporary;
    begin
        SeedHX163Fixture();

        LeaseBalance.FillBalances(20270131D, Buffer);

        AssertHX163Row(Buffer, 'HX163-L1', 'HX163-V1', 100, 1, 'Only the January invoice is up to AsOf');
    end;

    [Test]
    procedure InvoiceDatedOnAsOfCounted()
    var
        Buffer: Record "CGR Lease Balance Buffer" temporary;
    begin
        ClearHX163();
        AddHX163Lease('HX163-L5', 'HX163-V5');
        AddHX163Invoice('HX163-L5', 10000, 20270331D, 80);
        AddHX163Invoice('HX163-L5', 20000, 20270401D, 40);

        LeaseBalance.FillBalances(20270331D, Buffer);

        AssertHX163Row(Buffer, 'HX163-L5', 'HX163-V5', 80, 1, 'An invoice dated exactly AsOf counts, the next day does not');
    end;

    [Test]
    procedure UninvoicedLeaseListedAtZero()
    var
        Buffer: Record "CGR Lease Balance Buffer" temporary;
    begin
        SeedHX163Fixture();

        LeaseBalance.FillBalances(20270331D, Buffer);

        AssertHX163Row(Buffer, 'HX163-L3', 'HX163-V2', 0, 0, 'A lease with no invoices');
    end;

    [Test]
    procedure LeaseInvoicedAfterAsOfListedAtZero()
    var
        Buffer: Record "CGR Lease Balance Buffer" temporary;
    begin
        SeedHX163Fixture();

        LeaseBalance.FillBalances(20270331D, Buffer);

        AssertHX163Row(Buffer, 'HX163-L4', 'HX163-V3', 0, 0, 'A lease invoiced only after AsOf');
    end;

    [Test]
    procedure SecondAsOfGivesOwnBalances()
    var
        Buffer: Record "CGR Lease Balance Buffer" temporary;
    begin
        SeedHX163Fixture();

        LeaseBalance.FillBalances(20270131D, Buffer);
        AssertHX163Row(Buffer, 'HX163-L1', 'HX163-V1', 100, 1, 'January: first invoice only');
        AssertHX163Row(Buffer, 'HX163-L2', 'HX163-V1', 0, 0, 'January: nothing invoiced yet');

        LeaseBalance.FillBalances(20270630D, Buffer);
        AssertHX163Row(Buffer, 'HX163-L1', 'HX163-V1', 200, 2, 'June: both invoices');
        AssertHX163Row(Buffer, 'HX163-L2', 'HX163-V1', 250, 1, 'June: the March invoice');
        AssertHX163Row(Buffer, 'HX163-L4', 'HX163-V3', 75, 1, 'June: the May invoice');
    end;

    local procedure SeedHX163Fixture()
    begin
        ClearHX163();
        AddHX163Lease('HX163-L1', 'HX163-V1');
        AddHX163Invoice('HX163-L1', 10000, 20270115D, 100);
        AddHX163Invoice('HX163-L1', 20000, 20270215D, 100);
        AddHX163Lease('HX163-L2', 'HX163-V1');
        AddHX163Invoice('HX163-L2', 10000, 20270315D, 250);
        AddHX163Lease('HX163-L3', 'HX163-V2');
        AddHX163Lease('HX163-L4', 'HX163-V3');
        AddHX163Invoice('HX163-L4', 10000, 20270515D, 75);
    end;

    local procedure ClearHX163()
    var
        Lease: Record "CGR Lease Contract";
        LeaseInvoice: Record "CGR Lease Invoice";
    begin
        WorkDate(20270331D);
        LeaseInvoice.SetFilter("Contract No.", 'HX163-*');
        LeaseInvoice.DeleteAll();
        Lease.SetFilter("No.", 'HX163-*');
        Lease.DeleteAll();
    end;

    local procedure AddHX163Lease(LeaseNo: Code[20]; VehicleNo: Code[20])
    var
        Lease: Record "CGR Lease Contract";
    begin
        Lease.Init();
        Lease."No." := LeaseNo;
        Lease."Vehicle No." := VehicleNo;
        Lease."Customer Name" := 'HX163 Customer';
        Lease."Start Date" := 20270101D;
        Lease.Months := 12;
        Lease."Base Rate" := 100;
        Lease.Insert();
    end;

    local procedure AddHX163Invoice(LeaseNo: Code[20]; LineNo: Integer; InvoiceDate: Date; Amount: Decimal)
    var
        LeaseInvoice: Record "CGR Lease Invoice";
    begin
        LeaseInvoice.Init();
        LeaseInvoice."Contract No." := LeaseNo;
        LeaseInvoice."Line No." := LineNo;
        LeaseInvoice."Invoice Date" := InvoiceDate;
        LeaseInvoice.Amount := Amount;
        LeaseInvoice.Insert();
    end;

    local procedure AssertHX163Row(var Buffer: Record "CGR Lease Balance Buffer" temporary; LeaseNo: Code[20]; VehicleNo: Code[20]; Amount: Decimal; Invoices: Integer; Context: Text)
    begin
        Buffer.Reset();
        Buffer.SetRange("Lease No.", LeaseNo);
        Assert.AreEqual(1, Buffer.Count(), Context + ': one buffer row for the lease');
        Buffer.FindFirst();
        Assert.AreEqual(VehicleNo, Buffer."Vehicle No.", Context + ': vehicle');
        Assert.AreEqual(Amount, Buffer."Invoiced Amount", Context + ': invoiced amount');
        Assert.AreEqual(Invoices, Buffer.Invoices, Context + ': number of invoices');
    end;
}
