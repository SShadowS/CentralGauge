codeunit 69913 "CG X040 Engine"
{
    trigger OnRun()
    var
        Marker: Record "CG X040 Ledger";
        Step1: Record "CG X040 Ledger";
        Step2: Record "CG X040 Ledger";
        Log: Record "CG X040 Log";
        Payload: Integer;
        BatchId: Integer;
    begin
        Marker.SetRange(Step, 0);
        if not Marker.FindFirst() then
            Error('CG X040 Engine: no pending batch');

        // The caller stashes its input value in the pending marker row's
        // Amount field; capture it before the marker is deleted.
        BatchId := Marker."Batch Id";
        Payload := Marker.Amount;

        Log.SetRange("Batch Id", BatchId);
        Log.SetRange(Phase, 'STARTED');
        if Log.IsEmpty() then
            Error('CG X040 Engine: batch not registered');

        // Opaque, non-obvious formulas: a caller cannot pass by inlining a
        // plausible guess for what the engine computes.
        Step1.Init();
        Step1."Batch Id" := BatchId;
        Step1.Step := 1;
        Step1.Amount := BatchId * 11 + 7;
        Step1.Insert();

        Step2.Init();
        Step2."Batch Id" := BatchId;
        Step2.Step := 2;
        Step2.Amount := BatchId * 5 + 9;
        Step2.Insert();

        Marker.Delete();

        if Payload < 0 then
            Error('CG X040 Engine: payload %1 rejected', Payload);
    end;
}
