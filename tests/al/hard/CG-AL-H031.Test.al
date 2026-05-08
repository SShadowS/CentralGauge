codeunit 80231 "CG-AL-H031 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Calc: Codeunit "CG H031 FlowField Calc";

    [Test]
    procedure TestGetFieldClassText_FlowField()
    var
        Customer: Record Customer;
    begin
        Assert.AreEqual('FlowField',
            Calc.GetFieldClassText(Database::Customer, Customer.FieldNo("Balance (LCY)")),
            'Customer."Balance (LCY)" is a FlowField');
    end;

    [Test]
    procedure TestGetFieldClassText_Normal()
    var
        Customer: Record Customer;
    begin
        Assert.AreEqual('Normal',
            Calc.GetFieldClassText(Database::Customer, Customer.FieldNo("No.")),
            'Customer."No." is a Normal field');
    end;

    [Test]
    procedure TestGetFieldClassText_Missing()
    begin
        Assert.AreEqual('', Calc.GetFieldClassText(Database::Customer, 9999999),
            'Missing field returns empty');
    end;

    [Test]
    procedure TestIsFlowField_True()
    var
        Customer: Record Customer;
    begin
        Assert.IsTrue(Calc.IsFlowField(Database::Customer, Customer.FieldNo("Balance (LCY)")),
            'Balance (LCY) is FlowField');
    end;

    [Test]
    procedure TestIsFlowField_False_Normal()
    var
        Customer: Record Customer;
    begin
        Assert.IsFalse(Calc.IsFlowField(Database::Customer, Customer.FieldNo("No.")),
            'No. is not FlowField');
    end;

    [Test]
    procedure TestIsFlowField_False_Missing()
    begin
        Assert.IsFalse(Calc.IsFlowField(Database::Customer, 9999999),
            'Missing field is not FlowField');
    end;

    [Test]
    procedure TestCalcIfFlowField_True()
    var
        Customer: Record Customer;
        RecRef: RecordRef;
    begin
        if not Customer.FindFirst() then
            exit;
        RecRef.GetTable(Customer);
        Assert.IsTrue(Calc.CalcIfFlowField(RecRef, Customer.FieldNo("Balance (LCY)")),
            'CalcIfFlowField returns true for FlowField');
        RecRef.Close();
    end;

    [Test]
    procedure TestCalcIfFlowField_False_Normal()
    var
        Customer: Record Customer;
        RecRef: RecordRef;
    begin
        Customer.Init();
        RecRef.GetTable(Customer);
        Assert.IsFalse(Calc.CalcIfFlowField(RecRef, Customer.FieldNo("No.")),
            'CalcIfFlowField returns false for Normal field');
        RecRef.Close();
    end;

    [Test]
    procedure TestCalcIfFlowField_False_Missing()
    var
        Customer: Record Customer;
        RecRef: RecordRef;
    begin
        Customer.Init();
        RecRef.GetTable(Customer);
        Assert.IsFalse(Calc.CalcIfFlowField(RecRef, 9999999),
            'CalcIfFlowField returns false for missing field');
        RecRef.Close();
    end;

    [Test]
    procedure TestGetCalculatedDecimal_FlowField()
    var
        Customer: Record Customer;
        RecRef: RecordRef;
        Balance: Decimal;
    begin
        Customer.Init();
        RecRef.GetTable(Customer);
        Balance := Calc.GetCalculatedDecimal(RecRef, Customer.FieldNo("Balance (LCY)"));
        Assert.AreEqual(0, Balance,
            'Balance for empty Customer is 0');
        RecRef.Close();
    end;

    [Test]
    procedure TestGetCalculatedDecimal_Missing()
    var
        Customer: Record Customer;
        RecRef: RecordRef;
    begin
        Customer.Init();
        RecRef.GetTable(Customer);
        Assert.AreEqual(0, Calc.GetCalculatedDecimal(RecRef, 9999999),
            'Missing field returns 0');
        RecRef.Close();
    end;

    [Test]
    procedure TestIsFlowFilter_True()
    begin
        Assert.IsTrue(Calc.IsFlowFilter(69311, 20),
            'CG H031 Group."Date Filter" is FlowFilter');
    end;

    [Test]
    procedure TestIsFlowFilter_False_FlowField()
    begin
        Assert.IsFalse(Calc.IsFlowFilter(69311, 10),
            'Total Amount is FlowField, not FlowFilter');
    end;

    [Test]
    procedure TestIsFlowFilter_False_Normal()
    begin
        Assert.IsFalse(Calc.IsFlowFilter(69311, 1),
            'Code is Normal, not FlowFilter');
    end;

    [Test]
    procedure TestGetClassOrdinal_Normal()
    begin
        Assert.AreEqual(0, Calc.GetClassOrdinal(69311, 1),
            'Code is Normal -> 0');
    end;

    [Test]
    procedure TestGetClassOrdinal_FlowField()
    begin
        Assert.AreEqual(1, Calc.GetClassOrdinal(69311, 10),
            'Total Amount is FlowField -> 1');
    end;

    [Test]
    procedure TestGetClassOrdinal_FlowFilter()
    begin
        Assert.AreEqual(2, Calc.GetClassOrdinal(69311, 20),
            'Date Filter is FlowFilter -> 2');
    end;

    [Test]
    procedure TestGetClassOrdinal_Missing()
    begin
        Assert.AreEqual(-1, Calc.GetClassOrdinal(69311, 9999),
            'Missing field returns -1');
    end;

    [Test]
    procedure TestSumFieldByFilter_GroupA()
    begin
        SeedLedger();
        Assert.AreEqual(15, Calc.SumFieldByFilter(69310, 2, 'A', 10),
            'Group A: 5 + 10 = 15');
    end;

    [Test]
    procedure TestSumFieldByFilter_GroupB()
    begin
        SeedLedger();
        Assert.AreEqual(7, Calc.SumFieldByFilter(69310, 2, 'B', 10),
            'Group B: 7');
    end;

    [Test]
    procedure TestSumFieldByFilter_NoMatch()
    begin
        SeedLedger();
        Assert.AreEqual(0, Calc.SumFieldByFilter(69310, 2, 'NONE', 10),
            'No match returns 0');
    end;

    [Test]
    procedure TestCalcIfFlowField_OnGroup_TotalAmount()
    var
        Group: Record "CG H031 Group";
        RecRef: RecordRef;
        Total: Decimal;
    begin
        SeedLedger();
        ResetGroup();
        Group.Init();
        Group.Code := 'A';
        Group.Insert();
        Group.Get('A');
        RecRef.GetTable(Group);
        Total := Calc.GetCalculatedDecimal(RecRef, 10);
        Assert.AreEqual(15, Total,
            'CalcField on FlowField Total Amount must populate sum');
        RecRef.Close();
    end;

    local procedure SeedLedger()
    var
        L: Record "CG H031 Ledger";
    begin
        if not L.IsEmpty() then
            L.DeleteAll();
        InsertLedger(1, 'A', 5);
        InsertLedger(2, 'A', 10);
        InsertLedger(3, 'B', 7);
    end;

    local procedure ResetGroup()
    var
        G: Record "CG H031 Group";
    begin
        if not G.IsEmpty() then
            G.DeleteAll();
    end;

    local procedure InsertLedger(EntryNo: Integer; GroupCode: Code[10]; Amount: Decimal)
    var
        L: Record "CG H031 Ledger";
    begin
        L.Init();
        L."Entry No." := EntryNo;
        L."Group Code" := GroupCode;
        L.Amount := Amount;
        L.Insert();
    end;
}
