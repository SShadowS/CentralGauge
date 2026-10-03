codeunit 85940 "HX024 Customer Overview Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        RentalStatus: Enum "CGR Rental Status";

    [Test]
    procedure AmpersandNameLeaseAmount()
    var
        CustomerOverview: Codeunit "CGR Customer Overview";
    begin
        WorkDate(20270301D);
        ClearHX24Customer('HX24 Hansen & Son');
        InsertHX24Lease('HX24-L11', 'HX24 Hansen & Son');
        InsertHX24ScheduleLine('HX24-L11', 10000, 100, false);
        InsertHX24ScheduleLine('HX24-L11', 20000, 70, true);
        InsertHX24Lease('HX24-L12', 'HX24 Hansen & Son');
        InsertHX24ScheduleLine('HX24-L12', 10000, 50, false);

        Assert.AreEqual(150, CustomerOverview.OpenLeaseAmount('HX24 Hansen & Son'), 'Open lease amount of a customer whose name contains an ampersand');
    end;

    [Test]
    procedure AmpersandNameRentalCount()
    var
        CustomerOverview: Codeunit "CGR Customer Overview";
    begin
        WorkDate(20270301D);
        ClearHX24Customer('HX24 Hansen & Son');
        InsertHX24Rental('HX24-C21', 'HX24 Hansen & Son', RentalStatus::Open);
        InsertHX24Rental('HX24-C22', 'HX24 Hansen & Son', RentalStatus::"Checked Out");
        InsertHX24Rental('HX24-C23', 'HX24 Hansen & Son', RentalStatus::Returned);
        InsertHX24Rental('HX24-C24', 'HX24 Hansen & Son', RentalStatus::Posted);

        Assert.AreEqual(2, CustomerOverview.ActiveRentalCount('HX24 Hansen & Son'), 'Open and checked-out contracts of a customer whose name contains an ampersand');
    end;

    [Test]
    procedure RangeLikeNameRentalCount()
    var
        CustomerOverview: Codeunit "CGR Customer Overview";
    begin
        WorkDate(20270301D);
        ClearHX24Customer('HX24 A..Z Freight');
        ClearHX24Customer('HX24 B Cargo');
        InsertHX24Rental('HX24-C31', 'HX24 A..Z Freight', RentalStatus::Open);
        InsertHX24Rental('HX24-C32', 'HX24 B Cargo', RentalStatus::Open);

        Assert.AreEqual(1, CustomerOverview.ActiveRentalCount('HX24 A..Z Freight'), 'Only the contracts of the customer named A..Z Freight count');
    end;

    [Test]
    procedure RangeLikeNameLeaseAmount()
    var
        CustomerOverview: Codeunit "CGR Customer Overview";
    begin
        WorkDate(20270301D);
        ClearHX24Customer('HX24 A..Z Freight');
        ClearHX24Customer('HX24 B Cargo');
        InsertHX24Lease('HX24-L41', 'HX24 A..Z Freight');
        InsertHX24ScheduleLine('HX24-L41', 10000, 80, false);
        InsertHX24Lease('HX24-L42', 'HX24 B Cargo');
        InsertHX24ScheduleLine('HX24-L42', 10000, 20, false);

        Assert.AreEqual(80, CustomerOverview.OpenLeaseAmount('HX24 A..Z Freight'), 'Only the leases of the customer named A..Z Freight count');
    end;

    [Test]
    procedure PlainNameUnchanged()
    var
        CustomerOverview: Codeunit "CGR Customer Overview";
    begin
        WorkDate(20270301D);
        ClearHX24Customer('HX24 Berg Transport');
        InsertHX24Rental('HX24-C51', 'HX24 Berg Transport', RentalStatus::Open);
        InsertHX24Rental('HX24-C52', 'HX24 Berg Transport', RentalStatus::Posted);
        InsertHX24Lease('HX24-L51', 'HX24 Berg Transport');
        InsertHX24ScheduleLine('HX24-L51', 10000, 60, false);
        InsertHX24ScheduleLine('HX24-L51', 20000, 25, true);

        Assert.AreEqual(1, CustomerOverview.ActiveRentalCount('HX24 Berg Transport'), 'Active rental count of a plain customer name');
        Assert.AreEqual(60, CustomerOverview.OpenLeaseAmount('HX24 Berg Transport'), 'Open lease amount of a plain customer name');
    end;

    [Test]
    procedure WildcardNameRentalCount()
    var
        CustomerOverview: Codeunit "CGR Customer Overview";
    begin
        WorkDate(20270301D);
        ClearHX24Customer('HX24 Auto*Huset');
        ClearHX24Customer('HX24 Auto Huset');
        InsertHX24Rental('HX24-C61', 'HX24 Auto*Huset', RentalStatus::Open);
        InsertHX24Rental('HX24-C62', 'HX24 Auto Huset', RentalStatus::Open);

        Assert.AreEqual(1, CustomerOverview.ActiveRentalCount('HX24 Auto*Huset'), 'Only the contracts of the customer named Auto*Huset count');
    end;

    [Test]
    procedure WildcardNameLeaseAmount()
    var
        CustomerOverview: Codeunit "CGR Customer Overview";
    begin
        WorkDate(20270301D);
        ClearHX24Customer('HX24 Auto*Huset');
        ClearHX24Customer('HX24 Auto Huset');
        InsertHX24Lease('HX24-L71', 'HX24 Auto*Huset');
        InsertHX24ScheduleLine('HX24-L71', 10000, 45, false);
        InsertHX24Lease('HX24-L72', 'HX24 Auto Huset');
        InsertHX24ScheduleLine('HX24-L72', 10000, 35, false);

        Assert.AreEqual(45, CustomerOverview.OpenLeaseAmount('HX24 Auto*Huset'), 'Only the leases of the customer named Auto*Huset count');
    end;

    [Test]
    procedure ApostropheNameRentalCount()
    var
        CustomerOverview: Codeunit "CGR Customer Overview";
    begin
        WorkDate(20270301D);
        ClearHX24Customer('HX24 O''Neill & Co');
        InsertHX24Rental('HX24-C81', 'HX24 O''Neill & Co', RentalStatus::Open);
        InsertHX24Rental('HX24-C82', 'HX24 O''Neill & Co', RentalStatus::"Checked Out");

        Assert.AreEqual(2, CustomerOverview.ActiveRentalCount('HX24 O''Neill & Co'), 'Active contracts of a customer whose name contains an apostrophe');
    end;

    local procedure ClearHX24Customer(CustomerName: Text[100])
    var
        RentalContract: Record "CGR Rental Contract";
        LeaseContract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        RentalContract.SetRange("Customer Name", CustomerName);
        RentalContract.DeleteAll();
        LeaseContract.SetRange("Customer Name", CustomerName);
        if LeaseContract.FindSet() then
            repeat
                ScheduleLine.SetRange("Contract No.", LeaseContract."No.");
                ScheduleLine.DeleteAll();
            until LeaseContract.Next() = 0;
        LeaseContract.DeleteAll();
    end;

    local procedure InsertHX24Rental(ContractNo: Code[20]; CustomerName: Text[100]; ContractStatus: Enum "CGR Rental Status")
    var
        RentalContract: Record "CGR Rental Contract";
    begin
        if RentalContract.Get(ContractNo) then
            RentalContract.Delete();
        RentalContract.Init();
        RentalContract."No." := ContractNo;
        RentalContract."Customer Name" := CustomerName;
        RentalContract."Start Date" := 20270301D;
        RentalContract."End Date" := 20270303D;
        RentalContract.Status := ContractStatus;
        RentalContract.Insert();
    end;

    local procedure InsertHX24Lease(LeaseNo: Code[20]; CustomerName: Text[100])
    var
        LeaseContract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        if LeaseContract.Get(LeaseNo) then
            LeaseContract.Delete();
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        ScheduleLine.DeleteAll();
        LeaseContract.Init();
        LeaseContract."No." := LeaseNo;
        LeaseContract."Customer Name" := CustomerName;
        LeaseContract."Start Date" := 20270301D;
        LeaseContract.Months := 3;
        LeaseContract."Base Rate" := 100;
        LeaseContract.Insert();
    end;

    local procedure InsertHX24ScheduleLine(LeaseNo: Code[20]; LineNo: Integer; LineAmount: Decimal; IsInvoiced: Boolean)
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        ScheduleLine.Init();
        ScheduleLine."Contract No." := LeaseNo;
        ScheduleLine."Line No." := LineNo;
        ScheduleLine."Due Date" := 20270301D;
        ScheduleLine.Amount := LineAmount;
        ScheduleLine.Invoiced := IsInvoiced;
        ScheduleLine.Insert();
    end;
}
