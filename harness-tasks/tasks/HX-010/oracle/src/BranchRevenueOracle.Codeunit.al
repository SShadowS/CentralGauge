codeunit 85660 "HX010 Branch Revenue Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure PostedEntryTakesContractBranch()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        SessionContext: Codeunit "CGR Session Context";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup();
        InitVehicle('HX010-A');
        ContractNo := ReturnedContract('HX010-A', 'HX10A');
        SessionContext.SetCurrentBranch('HX10B');

        RentalMgt.Post(ContractNo);
        Assert.AreEqual('HX10A', PostedBranch(ContractNo), 'The ledger entry carries the branch of the contract');
    end;

    [Test]
    procedure BatchPostedEntriesTakeContractBranch()
    var
        Contract: Record "CGR Rental Contract";
        BatchPost: Codeunit "CGR Rental Batch Post";
        SessionContext: Codeunit "CGR Session Context";
        FirstContractNo: Code[20];
        SecondContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup();
        InitVehicle('HX010-B1');
        InitVehicle('HX010-B2');
        FirstContractNo := ReturnedContract('HX010-B1', 'HX10G');
        SecondContractNo := ReturnedContract('HX010-B2', 'HX10H');
        SessionContext.SetCurrentBranch('HX10J');

        Contract.SetFilter("Vehicle No.", '%1|%2', 'HX010-B1', 'HX010-B2');
        Assert.AreEqual(2, BatchPost.PostBatch(Contract), 'Both contracts are posted');
        Assert.AreEqual('HX10G', PostedBranch(FirstContractNo), 'First ledger entry carries the branch of its contract');
        Assert.AreEqual('HX10H', PostedBranch(SecondContractNo), 'Second ledger entry carries the branch of its contract');
    end;

    [Test]
    procedure RevenueGroupedByBranchYearMonth()
    var
        Revenue: Query "CGR Revenue by Branch Month";
        Rows: Integer;
    begin
        WorkDate(20270301D);
        InitSetup();
        ClearBranchEntries('HX10C');
        InsertBranchEntry('HX10C', 20270110D, 100);
        InsertBranchEntry('HX10C', 20270120D, 50);
        InsertBranchEntry('HX10C', 20280105D, 70);

        Revenue.SetRange(BranchCode, 'HX10C');
        Revenue.Open();
        while Revenue.Read() do begin
            Rows += 1;
            Assert.AreEqual('HX10C', Revenue.BranchCode, 'Branch');
            Assert.AreEqual(1, Revenue.PostingMonth, 'Posting month');
            case Revenue.PostingYear of
                2027:
                    begin
                        Assert.AreEqual(150, Revenue.Amount, 'January 2027 revenue');
                        Assert.AreEqual(2, Revenue.EntryCount, 'January 2027 entries');
                    end;
                2028:
                    begin
                        Assert.AreEqual(70, Revenue.Amount, 'January 2028 revenue');
                        Assert.AreEqual(1, Revenue.EntryCount, 'January 2028 entries');
                    end;
                else
                    Assert.Fail(StrSubstNo('Unexpected year %1', Revenue.PostingYear));
            end;
        end;
        Revenue.Close();
        Assert.AreEqual(2, Rows, 'One row per year and month');
    end;

    [Test]
    procedure DateFilterBoundsInclusive()
    var
        Revenue: Query "CGR Revenue by Branch Month";
        Rows: Integer;
    begin
        WorkDate(20270301D);
        InitSetup();
        ClearBranchEntries('HX10D');
        InsertBranchEntry('HX10D', 20270228D, 1000);
        InsertBranchEntry('HX10D', 20270301D, 10);
        InsertBranchEntry('HX10D', 20270331D, 20);
        InsertBranchEntry('HX10D', 20270401D, 400);

        Revenue.SetRange(BranchCode, 'HX10D');
        Revenue.SetRange(PostingDateFilter, 20270301D, 20270331D);
        Revenue.Open();
        while Revenue.Read() do begin
            Rows += 1;
            Assert.AreEqual(2027, Revenue.PostingYear, 'Posting year');
            Assert.AreEqual(3, Revenue.PostingMonth, 'Only March is inside the filter');
            Assert.AreEqual(30, Revenue.Amount, 'Entries on the first and the last day of the filter');
            Assert.AreEqual(2, Revenue.EntryCount, 'Entries inside the filter');
        end;
        Revenue.Close();
        Assert.AreEqual(1, Rows, 'One row for the filtered period');
    end;

    [Test]
    procedure BranchesAreSeparateRows()
    var
        Revenue: Query "CGR Revenue by Branch Month";
        Rows: Integer;
    begin
        WorkDate(20270301D);
        InitSetup();
        ClearBranchEntries('HX10E');
        ClearBranchEntries('HX10F');
        InsertBranchEntry('HX10E', 20270510D, 40);
        InsertBranchEntry('HX10E', 20270520D, 5);
        InsertBranchEntry('HX10F', 20270512D, 60);

        Revenue.SetFilter(BranchCode, '%1|%2', 'HX10E', 'HX10F');
        Revenue.Open();
        while Revenue.Read() do begin
            Rows += 1;
            Assert.AreEqual(2027, Revenue.PostingYear, 'Posting year');
            Assert.AreEqual(5, Revenue.PostingMonth, 'Posting month');
            case Revenue.BranchCode of
                'HX10E':
                    begin
                        Assert.AreEqual(45, Revenue.Amount, 'First branch revenue');
                        Assert.AreEqual(2, Revenue.EntryCount, 'First branch entries');
                    end;
                'HX10F':
                    begin
                        Assert.AreEqual(60, Revenue.Amount, 'Second branch revenue');
                        Assert.AreEqual(1, Revenue.EntryCount, 'Second branch entries');
                    end;
                else
                    Assert.Fail(StrSubstNo('Unexpected branch %1', Revenue.BranchCode));
            end;
        end;
        Revenue.Close();
        Assert.AreEqual(2, Rows, 'One row per branch');
    end;

    local procedure InitSetup()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := 0;
        Setup."Km Allowance per Day" := 1000;
        Setup."Excess Km Rate" := 0;
        Setup."Suspend Rentals" := false;
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure InitVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.SetRange("Vehicle No.", VehicleNo);
        LedgerEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle."Daily Rate" := 50;
        Vehicle.Insert();
    end;

    local procedure ReturnedContract(VehicleNo: Code[20]; BranchCode: Code[10]): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        SessionContext: Codeunit "CGR Session Context";
        ContractNo: Code[20];
    begin
        SessionContext.SetCurrentBranch(BranchCode);
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX010 Customer', 20270301D, 20270303D);
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1100, '');
        exit(ContractNo);
    end;

    local procedure PostedBranch(ContractNo: Code[20]): Code[10]
    var
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, LedgerEntry.Count(), 'One ledger entry per posted contract');
        LedgerEntry.FindFirst();
        exit(LedgerEntry."Branch Code");
    end;

    local procedure ClearBranchEntries(BranchCode: Code[10])
    var
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.SetRange("Branch Code", BranchCode);
        LedgerEntry.DeleteAll();
    end;

    local procedure InsertBranchEntry(BranchCode: Code[10]; PostingDate: Date; Amount: Decimal)
    var
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.Init();
        LedgerEntry."Vehicle No." := 'HX010-Q';
        LedgerEntry."Posting Date" := PostingDate;
        LedgerEntry.Amount := Amount;
        LedgerEntry."Branch Code" := BranchCode;
        LedgerEntry.Insert();
    end;
}
