codeunit 69891 "CG X037 Worker"
{
    trigger OnRun()
    var
        Ledger: Record "CG X037 Ledger";
        Step1: Record "CG X037 Ledger";
        Step2: Record "CG X037 Ledger";
        Value: Integer;
    begin
        Ledger.SetRange(Step, 0);
        if not Ledger.FindFirst() then
            Error('CG X037 Worker: no pending batch');

        // The caller stashes its input value in the pending marker row's
        // Amount field; capture it before the marker is replaced.
        Value := Ledger.Amount;

        // Step 1: durable write, committed BEFORE the designed failure check.
        Step1.Init();
        Step1."Batch Id" := Ledger."Batch Id";
        Step1.Step := 1;
        // Opaque, non-obvious formula: a caller cannot pass by inlining a
        // plausible guess for what the worker computes.
        Step1.Amount := Ledger."Batch Id" * 13 + 5;
        Step1.Insert();
        Ledger.Delete();
        Commit();

        // Step 2: written AFTER the commit above, so it rolls back with the
        // worker's own error below — but Step 1 above does NOT.
        Step2.Init();
        Step2."Batch Id" := Ledger."Batch Id";
        Step2.Step := 2;
        Step2.Amount := Ledger."Batch Id" * 17 + 3;
        Step2.Insert();

        if Value < 0 then
            Error('CG X037 Worker: value %1 rejected', Value);
    end;
}
