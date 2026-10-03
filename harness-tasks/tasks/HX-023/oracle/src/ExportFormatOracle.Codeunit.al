codeunit 85920 "HX023 Export Format Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure FormatAmountPadsToTwoDecimals()
    var
        ExportFormat: Codeunit "CGR Export Format";
    begin
        WorkDate(20270301D);
        Assert.AreEqual('103.50', ExportFormat.FormatAmount(103.5), 'One decimal is padded to two');
        Assert.AreEqual('12.35', ExportFormat.FormatAmount(12.35), 'Two decimals stay two decimals');
    end;

    [Test]
    procedure FormatAmountHasNoGroupSeparator()
    var
        ExportFormat: Codeunit "CGR Export Format";
    begin
        WorkDate(20270301D);
        Assert.AreEqual('1234.50', ExportFormat.FormatAmount(1234.5), 'No thousands separator, two decimals');
    end;

    [Test]
    procedure FormatAmountWholeValueHasDecimals()
    var
        ExportFormat: Codeunit "CGR Export Format";
    begin
        WorkDate(20270301D);
        Assert.AreEqual('250.00', ExportFormat.FormatAmount(250), 'A whole amount gets two decimals');
    end;

    [Test]
    procedure FormatDateIsYearMonthDay()
    var
        ExportFormat: Codeunit "CGR Export Format";
    begin
        WorkDate(20270301D);
        Assert.AreEqual('2027-03-01', ExportFormat.FormatDate(20270301D), 'Date as yyyy-mm-dd');
        Assert.AreEqual('2027-11-15', ExportFormat.FormatDate(20271115D), 'Date as yyyy-mm-dd, two-digit month');
    end;

    [Test]
    procedure LeaseLineGroupedAmount()
    begin
        WorkDate(20270301D);
        Assert.AreEqual('HX23-L1;HX23-V1;2027-03-01;1234.50', ExportLease('HX23-L1', 20270301D, 1234.5), 'Lease export line');
    end;

    [Test]
    procedure LeaseLineHalfAmount()
    begin
        WorkDate(20270301D);
        Assert.AreEqual('HX23-L2;HX23-V1;2027-03-15;103.50', ExportLease('HX23-L2', 20270315D, 103.5), 'Lease export line');
    end;

    [Test]
    procedure LeaseLineWholeAmount()
    begin
        WorkDate(20270301D);
        Assert.AreEqual('HX23-L3;HX23-V1;2027-03-31;250.00', ExportLease('HX23-L3', 20270331D, 250), 'Lease export line');
    end;

    [Test]
    procedure RentalEntryGroupedValues()
    begin
        WorkDate(20270301D);
        Assert.AreEqual('HX23-R1;HX23-V2;2027-03-03;1234.50;1500', ExportRental('HX23-R1', 'HX23-V2', 20270303D, 1234.5, 1500), 'Rental export line');
    end;

    [Test]
    procedure RentalEntryWholeAmount()
    begin
        WorkDate(20270301D);
        Assert.AreEqual('HX23-R2;HX23-V2;2027-03-04;250.00;85', ExportRental('HX23-R2', 'HX23-V2', 20270304D, 250, 85), 'Rental export line');
    end;

    [Test]
    procedure RentalEntrySmallValues()
    begin
        WorkDate(20270301D);
        Assert.AreEqual('HX23-R3;HX23-V3;2027-11-15;12.35;7', ExportRental('HX23-R3', 'HX23-V3', 20271115D, 12.35, 7), 'Rental export line');
    end;

    local procedure ExportLease(ContractNo: Code[20]; InvoiceDate: Date; LineAmount: Decimal): Text
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        LeaseExport: Codeunit "CGR Lease Invoice Export";
    begin
        InvoiceLine.Init();
        InvoiceLine."Contract No." := ContractNo;
        InvoiceLine."Schedule Line No." := 10000;
        InvoiceLine."Vehicle No." := 'HX23-V1';
        InvoiceLine."Invoice Date" := InvoiceDate;
        InvoiceLine.Amount := LineAmount;
        exit(LeaseExport.ExportLine(InvoiceLine));
    end;

    local procedure ExportRental(ContractNo: Code[20]; VehicleNo: Code[20]; PostingDate: Date; EntryAmount: Decimal; KmDriven: Integer): Text
    var
        LedgerEntry: Record "CGR Rental Ledger Entry";
        LedgerExport: Codeunit "CGR Rental Ledger Export";
    begin
        LedgerEntry.Init();
        LedgerEntry."Contract No." := ContractNo;
        LedgerEntry."Vehicle No." := VehicleNo;
        LedgerEntry."Posting Date" := PostingDate;
        LedgerEntry.Amount := EntryAmount;
        LedgerEntry."Km Driven" := KmDriven;
        exit(LedgerExport.ExportEntry(LedgerEntry));
    end;
}
