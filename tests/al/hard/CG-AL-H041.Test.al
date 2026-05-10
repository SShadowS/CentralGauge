codeunit 80256 "CG-AL-H041 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Batch: Codeunit "CG H041 Batch";

    [Test]
    [TransactionModel(TransactionModel::AutoCommit)]
    procedure TestRunBatch_MixedOutcomes()
    var
        Item: Record "CG H041 Item";
        RunLog: Record "CG H041 Run Log";
        Codes: List of [Code[20]];
        Outcomes: List of [Code[10]];
    begin
        // [SCENARIO] Three items: OK, BAD, OK. The worker errors on BAD; Codeunit.Run
        // rolls that one back. The loop must continue. The Run Log row must be
        // written AFTER the loop, not inside it - if RunBatch writes to any DB table
        // inside the loop, the second Codeunit.Run will error because Codeunit.Run
        // cannot nest in an open write transaction.
        ResetAll();
        Insert('A1', 'NEW', 'OK');
        Insert('A2', 'NEW', 'BAD');
        Insert('A3', 'NEW', 'OK');
        Commit();

        Codes.Add('A1');
        Codes.Add('A2');
        Codes.Add('A3');

        Outcomes := Batch.RunBatch(Codes);

        Assert.AreEqual(3, Outcomes.Count, 'Outcomes count must equal Codes count.');
        Assert.AreEqual('OK', Outcomes.Get(1), 'A1 outcome must be OK.');
        Assert.AreEqual('FAIL', Outcomes.Get(2), 'A2 outcome must be FAIL.');
        Assert.AreEqual('OK', Outcomes.Get(3), 'A3 outcome must be OK.');

        Item.Get('A1');
        Assert.AreEqual('DONE', Item.Status, 'A1 Status must be DONE (worker success persisted).');
        Item.Get('A2');
        Assert.AreEqual('NEW', Item.Status, 'A2 Status must remain NEW (worker errored, atomic rollback).');
        Item.Get('A3');
        Assert.AreEqual('DONE', Item.Status, 'A3 Status must be DONE - the loop must continue past A2''s failure AND the third Codeunit.Run must succeed (no open outer transaction).');

        Assert.AreEqual(1, RunLog.Count, 'Exactly one Run Log row must be inserted, after the loop.');
        RunLog.FindFirst();
        Assert.AreEqual('OK|FAIL|OK', RunLog.Outcomes, 'Run Log Outcomes must be the joined list.');

        ResetAll();
    end;

    [Test]
    [TransactionModel(TransactionModel::AutoCommit)]
    procedure TestRunBatch_AllSuccess()
    var
        Item: Record "CG H041 Item";
        RunLog: Record "CG H041 Run Log";
        Codes: List of [Code[20]];
        Outcomes: List of [Code[10]];
    begin
        ResetAll();
        Insert('B1', 'NEW', 'OK');
        Insert('B2', 'NEW', 'OK');
        Commit();

        Codes.Add('B1');
        Codes.Add('B2');

        Outcomes := Batch.RunBatch(Codes);

        Assert.AreEqual('OK', Outcomes.Get(1), 'B1 outcome must be OK.');
        Assert.AreEqual('OK', Outcomes.Get(2), 'B2 outcome must be OK.');

        Item.Get('B1');
        Assert.AreEqual('DONE', Item.Status, 'B1 must be DONE.');
        Item.Get('B2');
        Assert.AreEqual('DONE', Item.Status, 'B2 must be DONE.');

        RunLog.FindFirst();
        Assert.AreEqual('OK|OK', RunLog.Outcomes, 'Run Log must capture both OK outcomes.');

        ResetAll();
    end;

    [Test]
    [TransactionModel(TransactionModel::AutoCommit)]
    procedure TestRunBatch_AllFail()
    var
        Item: Record "CG H041 Item";
        RunLog: Record "CG H041 Run Log";
        Codes: List of [Code[20]];
        Outcomes: List of [Code[10]];
    begin
        ResetAll();
        Insert('C1', 'NEW', 'BAD');
        Insert('C2', 'NEW', 'BAD');
        Commit();

        Codes.Add('C1');
        Codes.Add('C2');

        Outcomes := Batch.RunBatch(Codes);

        Assert.AreEqual('FAIL', Outcomes.Get(1), 'C1 outcome must be FAIL.');
        Assert.AreEqual('FAIL', Outcomes.Get(2), 'C2 outcome must be FAIL.');

        Item.Get('C1');
        Assert.AreEqual('NEW', Item.Status, 'C1 must remain NEW (worker rolled back).');
        Item.Get('C2');
        Assert.AreEqual('NEW', Item.Status, 'C2 must remain NEW (worker rolled back).');

        RunLog.FindFirst();
        Assert.AreEqual('FAIL|FAIL', RunLog.Outcomes, 'Run Log must capture both FAIL outcomes.');

        ResetAll();
    end;

    local procedure Insert(Code: Code[20]; Status: Code[10]; Marker: Code[10])
    var
        Item: Record "CG H041 Item";
    begin
        Item.Init();
        Item.Code := Code;
        Item.Status := Status;
        Item.Marker := Marker;
        Item.Insert();
    end;

    local procedure ResetAll()
    var
        Item: Record "CG H041 Item";
        RunLog: Record "CG H041 Run Log";
    begin
        if not Item.IsEmpty() then
            Item.DeleteAll();
        if not RunLog.IsEmpty() then
            RunLog.DeleteAll();
        Commit();
    end;
}
