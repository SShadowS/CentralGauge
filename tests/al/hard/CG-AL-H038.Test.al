codeunit 80253 "CG-AL-H038 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Coordinator: Codeunit "CG H038 Coordinator";

    [Test]
    [TransactionModel(TransactionModel::AutoCommit)]
    procedure TestProcessJob_Success_PersistsDoneStatus()
    var
        Job: Record "CG H038 Job";
        Result: Boolean;
    begin
        ResetJob('OK1');
        Insert('OK1', 'NEW', 'GOOD');
        Commit();

        Result := Coordinator.ProcessJob('OK1');

        Assert.IsTrue(Result, 'ProcessJob must return true on worker success.');
        Job.Get('OK1');
        Assert.AreEqual('DONE', Job.Status, 'Worker''s final Status:=DONE Modify must persist after Codeunit.Run completes.');

        Job.Delete();
        Commit();
    end;

    [Test]
    [TransactionModel(TransactionModel::AutoCommit)]
    procedure TestProcessJob_WorkerError_RollsBackProcessingStatus()
    var
        Job: Record "CG H038 Job";
        Result: Boolean;
    begin
        // [SCENARIO] Worker sets Status:=PROCESSING then errors. The atomic sub-operation
        // primitive must roll the PROCESSING modification back so Status reverts to NEW.
        ResetJob('FAIL1');
        Insert('FAIL1', 'NEW', 'BAD');
        Commit();

        Result := Coordinator.ProcessJob('FAIL1');

        Assert.IsFalse(Result, 'ProcessJob must return false when the worker errors.');
        Job.Get('FAIL1');
        Assert.AreEqual('NEW', Job.Status, 'Status must remain NEW: the worker''s Status:=PROCESSING must be rolled back when the worker errors.');

        Job.Delete();
        Commit();
    end;

    [Test]
    [TransactionModel(TransactionModel::AutoCommit)]
    procedure TestProcessJob_DoesNotPropagateError()
    var
        Job: Record "CG H038 Job";
    begin
        // ProcessJob must SWALLOW the worker's Error and return false.
        ResetJob('FAIL2');
        Insert('FAIL2', 'NEW', 'BAD');
        Commit();

        // No asserterror - the call must complete normally.
        Coordinator.ProcessJob('FAIL2');

        Job.Get('FAIL2');
        Assert.AreEqual('NEW', Job.Status, 'Status remains NEW after a swallowed worker error.');

        Job.Delete();
        Commit();
    end;

    local procedure Insert(Code: Code[20]; Status: Code[10]; Marker: Code[10])
    var
        Job: Record "CG H038 Job";
    begin
        Job.Init();
        Job.Code := Code;
        Job.Status := Status;
        Job.Marker := Marker;
        Job.Insert();
    end;

    local procedure ResetJob(Code: Code[20])
    var
        Job: Record "CG H038 Job";
    begin
        if Job.Get(Code) then begin
            Job.Delete();
            Commit();
        end;
    end;
}
