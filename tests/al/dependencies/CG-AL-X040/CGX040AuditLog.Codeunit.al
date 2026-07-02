codeunit 69912 "CG X040 Audit Log"
{
    // Looks like a pure insert. It is not: the Commit below silently moves
    // the caller's rollback boundary, so anything the caller wrote before
    // calling this also becomes durable — not just this procedure's own row.
    procedure Write(BatchId: Integer; Phase: Code[10])
    var
        Log: Record "CG X040 Log";
    begin
        Log.Init();
        Log."Batch Id" := BatchId;
        Log.Phase := Phase;
        Log.Insert();
        Commit();
    end;
}
