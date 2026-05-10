codeunit 80235 "CG-AL-H034 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    [TransactionModel(TransactionModel::AutoCommit)]
    procedure TestSubscriberCommitSuppressed_StatusRolledBackOnError()
    var
        Item: Record "CG H034 Item";
        Engine: Codeunit "CG H034 Engine";
    begin
        // [SCENARIO] Publisher OnBeforeFinalize must carry [CommitBehavior(CommitBehavior::Ignore)].
        // Subscriber tries Commit while publisher's Modify is uncommitted; correct attribute
        // discards that Commit so the publisher's later Error rolls back Status:=true.
        ResetItem('FAIL1');
        Item.Init();
        Item.Code := 'FAIL1';
        Item.Status := false;
        Item.Marker := 'FAIL';
        Item.Insert();
        Commit();

        asserterror Engine.ProcessItem(Item);

        Item.Get('FAIL1');
        Assert.IsFalse(
            Item.Status,
            'Status must be FALSE after ProcessItem errors: subscriber Commit must be suppressed by [CommitBehavior(CommitBehavior::Ignore)] on the publisher so the Error rolls back Status:=true.');

        Item.Delete();
        Commit();
    end;

    [Test]
    [TransactionModel(TransactionModel::AutoCommit)]
    procedure TestSuccessPath_StatusCommitsToTrue()
    var
        Item: Record "CG H034 Item";
        Engine: Codeunit "CG H034 Engine";
    begin
        ResetItem('OK1');
        Item.Init();
        Item.Code := 'OK1';
        Item.Status := false;
        Item.Marker := 'OK';
        Item.Insert();
        Commit();

        Engine.ProcessItem(Item);

        Item.Get('OK1');
        Assert.IsTrue(Item.Status, 'Status must be TRUE on success path; ProcessItem must Modify then Commit.');

        Item.Delete();
        Commit();
    end;

    [Test]
    [TransactionModel(TransactionModel::AutoCommit)]
    procedure TestErrorMessageFormat()
    var
        Item: Record "CG H034 Item";
        Engine: Codeunit "CG H034 Engine";
    begin
        ResetItem('FAIL2');
        Item.Init();
        Item.Code := 'FAIL2';
        Item.Status := false;
        Item.Marker := 'FAIL';
        Item.Insert();
        Commit();

        asserterror Engine.ProcessItem(Item);
        Assert.ExpectedError('Process failed for FAIL2');

        if Item.Get('FAIL2') then begin
            Item.Delete();
            Commit();
        end;
    end;

    local procedure ResetItem(Code: Code[20])
    var
        Item: Record "CG H034 Item";
    begin
        if Item.Get(Code) then begin
            Item.Delete();
            Commit();
        end;
    end;
}
