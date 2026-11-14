codeunit 88690 "HX182 Contract Accrual Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure MayPostingsSummed()
    var
        Accrual: Codeunit "CGR Contract Accrual";
        Revenue: Dictionary of [Code[20], Decimal];
    begin
        Arrange();
        SeedSpreadContract('ACR182-A1');

        Revenue := Accrual.PostedRevenueBetween(20260501D, 20260531D);
        ExpectFigure(Revenue, 'ACR182-A1', 200.50);
    end;

    [Test]
    procedure FirstAndLastDayOfMayCount()
    var
        Accrual: Codeunit "CGR Contract Accrual";
        Revenue: Dictionary of [Code[20], Decimal];
    begin
        Arrange();
        SeedContract('ACR182-B1');
        AddPosting('ACR182-B1', 20260430D, 1000);
        AddPosting('ACR182-B1', 20260501D, 10.10);
        AddPosting('ACR182-B1', 20260531D, 20.20);
        AddPosting('ACR182-B1', 20260601D, 2000);

        Revenue := Accrual.PostedRevenueBetween(20260501D, 20260531D);
        ExpectFigure(Revenue, 'ACR182-B1', 30.30);
    end;

    [Test]
    procedure NeverPostedContractAtZero()
    var
        Accrual: Codeunit "CGR Contract Accrual";
        Revenue: Dictionary of [Code[20], Decimal];
    begin
        Arrange();
        SeedContract('ACR182-C1');

        Revenue := Accrual.PostedRevenueBetween(20260501D, 20260531D);
        ExpectFigure(Revenue, 'ACR182-C1', 0);
    end;

    [Test]
    procedure PostedOnlyBeforeAndAfterAtZero()
    var
        Accrual: Codeunit "CGR Contract Accrual";
        Revenue: Dictionary of [Code[20], Decimal];
    begin
        Arrange();
        SeedFebAugContract('ACR182-D1');

        Revenue := Accrual.PostedRevenueBetween(20260501D, 20260531D);
        ExpectFigure(Revenue, 'ACR182-D1', 0);
    end;

    [Test]
    procedure WholeContractBookInOneAnswer()
    var
        Accrual: Codeunit "CGR Contract Accrual";
        Revenue: Dictionary of [Code[20], Decimal];
    begin
        Arrange();
        SeedSpreadContract('ACR182-E1');
        SeedContract('ACR182-E2');
        SeedFebAugContract('ACR182-E3');

        Revenue := Accrual.PostedRevenueBetween(20260501D, 20260531D);
        Assert.AreEqual(3, KeysStartingWith(Revenue, 'ACR182-E'), 'Each of the three contracts has an accrual figure for May');
        ExpectFigure(Revenue, 'ACR182-E1', 200.50);
        ExpectFigure(Revenue, 'ACR182-E2', 0);
        ExpectFigure(Revenue, 'ACR182-E3', 0);
    end;

    [Test]
    procedure AugustAnswersForAugust()
    var
        Accrual: Codeunit "CGR Contract Accrual";
        Revenue: Dictionary of [Code[20], Decimal];
    begin
        Arrange();
        SeedSpreadContract('ACR182-F1');
        SeedContract('ACR182-F2');
        SeedFebAugContract('ACR182-F3');

        Revenue := Accrual.PostedRevenueBetween(20260801D, 20260831D);
        Assert.AreEqual(3, KeysStartingWith(Revenue, 'ACR182-F'), 'Each of the three contracts has an accrual figure for August');
        ExpectFigure(Revenue, 'ACR182-F1', 0);
        ExpectFigure(Revenue, 'ACR182-F2', 0);
        ExpectFigure(Revenue, 'ACR182-F3', 45.40);
    end;

    [Test]
    procedure AllTimeFiguresUnchanged()
    var
        Accrual: Codeunit "CGR Contract Accrual";
        Revenue: Dictionary of [Code[20], Decimal];
    begin
        Arrange();
        SeedSpreadContract('ACR182-G1');
        SeedContract('ACR182-G2');
        SeedFebAugContract('ACR182-G3');

        Revenue := Accrual.PostedRevenue();
        Assert.AreEqual(3, KeysStartingWith(Revenue, 'ACR182-G'), 'PostedRevenue still answers for every contract');
        ExpectFigure(Revenue, 'ACR182-G1', 288.75);
        ExpectFigure(Revenue, 'ACR182-G2', 0);
        ExpectFigure(Revenue, 'ACR182-G3', 105.40);
    end;

    local procedure ExpectFigure(Revenue: Dictionary of [Code[20], Decimal]; ContractNo: Code[20]; Expected: Decimal)
    var
        Actual: Decimal;
    begin
        Assert.IsTrue(Revenue.Get(ContractNo, Actual), StrSubstNo('Contract %1 is in the answer', ContractNo));
        Assert.AreEqual(Expected, Actual, StrSubstNo('Posted revenue of contract %1', ContractNo));
    end;

    local procedure KeysStartingWith(Revenue: Dictionary of [Code[20], Decimal]; Prefix: Text): Integer
    var
        ContractNo: Code[20];
        Found: Integer;
    begin
        foreach ContractNo in Revenue.Keys() do
            if CopyStr(ContractNo, 1, StrLen(Prefix)) = Prefix then
                Found += 1;
        exit(Found);
    end;

    local procedure Arrange()
    begin
        WorkDate(20260615D);
    end;

    local procedure SeedSpreadContract(ContractNo: Code[20])
    begin
        SeedContract(ContractNo);
        AddPosting(ContractNo, 20260504D, 120.50);
        AddPosting(ContractNo, 20260527D, 80);
        AddPosting(ContractNo, 20260430D, 55.25);
        AddPosting(ContractNo, 20260601D, 33);
    end;

    local procedure SeedFebAugContract(ContractNo: Code[20])
    begin
        SeedContract(ContractNo);
        AddPosting(ContractNo, 20260211D, 60);
        AddPosting(ContractNo, 20260819D, 45.40);
    end;

    local procedure SeedContract(ContractNo: Code[20])
    var
        RentalContract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.SetRange("Contract No.", ContractNo);
        LedgerEntry.DeleteAll();
        if RentalContract.Get(ContractNo) then
            RentalContract.Delete();
        RentalContract.Init();
        RentalContract."No." := ContractNo;
        RentalContract."Customer Name" := 'HX182 accrual customer';
        RentalContract."Start Date" := 20260201D;
        RentalContract.Insert();
    end;

    local procedure AddPosting(ContractNo: Code[20]; PostingDate: Date; Amount: Decimal)
    var
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.Init();
        LedgerEntry."Contract No." := ContractNo;
        LedgerEntry."Posting Date" := PostingDate;
        LedgerEntry.Amount := Amount;
        LedgerEntry.Insert();
    end;
}
