codeunit 69891 "CG X037 Engine"
{
    trigger OnRun()
    var
        Journal: Record "CG X037 Journal";
        Step1: Record "CG X037 Journal";
        Step2: Record "CG X037 Journal";
        Payload: Integer;
    begin
        Journal.SetRange(Step, 0);
        if not Journal.FindFirst() then
            Error('CG X037 Engine: no pending batch');

        // The caller stashes its input value in the pending marker row's
        // Amount field; capture it before the marker is replaced.
        Payload := Journal.Amount;

        // Step 1: durable write, committed BEFORE the designed failure check.
        Step1.Init();
        Step1."Batch Id" := Journal."Batch Id";
        Step1.Step := 1;
        // Opaque, non-obvious formula: a caller cannot pass by inlining a
        // plausible guess for what the engine computes.
        Step1.Amount := Journal."Batch Id" * 13 + 5;
        Step1.Insert();
        Journal.Delete();
        Commit();

        // Step 2: written AFTER the commit above, so it rolls back with the
        // engine's own error below — but Step 1 above does NOT.
        Step2.Init();
        Step2."Batch Id" := Journal."Batch Id";
        Step2.Step := 2;
        Step2.Amount := Journal."Batch Id" * 17 + 3;
        Step2.Insert();

        if Payload < 0 then
            Error('CG X037 Engine: payload %1 rejected', Payload);
    end;
}
