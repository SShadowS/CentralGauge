codeunit 80265 "CG-AL-H050 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Seed(var Email: Record "CG H050 Email")
    begin
        Email.DeleteAll();
        Add(Email, 1, 'alice@contoso.com');
        Add(Email, 2, 'invalid-one');
        Add(Email, 3, 'bob@contoso.com');
        Add(Email, 4, 'invalid-two');
        Add(Email, 5, 'invalid-three');
    end;

    local procedure Add(var Email: Record "CG H050 Email"; No: Integer; Addr: Text[80])
    begin
        Email.Init();
        Email."Entry No." := No;
        Email."Address" := Addr;
        Email.Insert();
    end;

    [Test]
    [TransactionModel(TransactionModel::AutoRollback)]
    procedure TestThreeInvalidsReturnsCount()
    var
        Email: Record "CG H050 Email";
        Validator: Codeunit "CG H050 Validator";
        Cnt: Integer;
    begin
        Seed(Email);
        Cnt := Validator.ValidateAll(Email);
        Assert.AreEqual(3, Cnt, '3 invalid rows should be reported.');
    end;

    [Test]
    [TransactionModel(TransactionModel::AutoRollback)]
    procedure TestNoInvalidReturnsZero()
    var
        Email: Record "CG H050 Email";
        Validator: Codeunit "CG H050 Validator";
        Cnt: Integer;
    begin
        Email.DeleteAll();
        Add(Email, 1, 'ok@contoso.com');
        Add(Email, 2, 'fine@contoso.com');
        Cnt := Validator.ValidateAll(Email);
        Assert.AreEqual(0, Cnt, 'All valid rows: count is zero.');
    end;

    [Test]
    [TransactionModel(TransactionModel::AutoRollback)]
    procedure TestEmptySetReturnsZero()
    var
        Email: Record "CG H050 Email";
        Validator: Codeunit "CG H050 Validator";
        Cnt: Integer;
    begin
        Email.DeleteAll();
        Cnt := Validator.ValidateAll(Email);
        Assert.AreEqual(0, Cnt, 'Empty set: count is zero, no thrown errors.');
    end;
}
