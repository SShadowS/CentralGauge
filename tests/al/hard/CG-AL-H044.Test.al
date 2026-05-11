codeunit 80259 "CG-AL-H044 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    [TransactionModel(TransactionModel::AutoRollback)]
    procedure TestNonTemporaryAborts()
    var
        RealDoc: Record "CG H044 Doc";
        Buffer: Codeunit "CG H044 Buffer";
    begin
        asserterror Buffer.ResetBuffer(RealDoc);
        Assert.ExpectedError('Buffer must be temporary.');
    end;

    [Test]
    [TransactionModel(TransactionModel::AutoRollback)]
    procedure TestTemporaryClearsBuffer()
    var
        TempDoc: Record "CG H044 Doc" temporary;
        Buffer: Codeunit "CG H044 Buffer";
    begin
        TempDoc."Code" := 'A';
        TempDoc.Insert();
        TempDoc."Code" := 'B';
        TempDoc.Insert();
        TempDoc."Code" := 'C';
        TempDoc.Insert();
        Assert.AreEqual(3, TempDoc.Count, 'Pre-condition: temp buffer holds 3 rows.');

        Buffer.ResetBuffer(TempDoc);

        Assert.AreEqual(0, TempDoc.Count, 'Temp buffer must be empty after ResetBuffer.');
    end;

    [Test]
    [TransactionModel(TransactionModel::AutoRollback)]
    procedure TestEmptyTemporaryAccepted()
    var
        TempDoc: Record "CG H044 Doc" temporary;
        Buffer: Codeunit "CG H044 Buffer";
    begin
        // An empty temp buffer is still temporary; the guard must permit it and DeleteAll must be a no-op.
        Buffer.ResetBuffer(TempDoc);
        Assert.AreEqual(0, TempDoc.Count, 'Empty temp buffer remains empty.');
    end;
}
