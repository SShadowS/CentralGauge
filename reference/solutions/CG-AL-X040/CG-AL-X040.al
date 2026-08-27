codeunit 71280 "CG X040 Poster"
{
    Access = Internal;

    procedure PostBatch(BatchId: Integer; Payload: Integer): Boolean
    var
        Ledger: Record "CG X040 Ledger";
        AuditLog: Codeunit "CG X040 Audit Log";
        Success: Boolean;
    begin
        AuditLog.Write(BatchId, 'STARTED');

        Ledger.Init();
        Ledger."Batch Id" := BatchId;
        Ledger.Step := 0;
        Ledger.Amount := Payload;
        Ledger.Insert();

        Commit();

        Success := Codeunit.Run(Codeunit::"CG X040 Engine", Ledger);

        if not Success then begin
            ClearLastError();
            Ledger.Reset();
            Ledger.SetRange("Batch Id", BatchId);
            if not Ledger.IsEmpty() then
                Ledger.DeleteAll();
        end;

        AuditLog.Write(BatchId, 'FINISHED');
        Commit();

        exit(Success);
    end;
}