codeunit 69942 "CG X042 Engine"
{
    trigger OnRun()
    var
        Marker: Record "CG X042 Order";
        Step1: Record "CG X042 Order";
        Shadow: Record "CG X042 Shadow";
        Payload: Integer;
        BatchId: Integer;
    begin
        Marker.SetRange(Step, 0);
        if not Marker.FindFirst() then
            Error('CG X042 Engine: no pending batch');

        // The caller stashes its input value in the pending marker row's
        // Amount field; capture it before the marker is deleted.
        BatchId := Marker."Batch Id";
        Payload := Marker.Amount;

        // The engine refuses to process any batch whose marker never
        // produced its companion row — a caller that skipped triggers on
        // the marker insert has nothing to be found here.
        if not Shadow.Get(BatchId, 0) then
            Error('CG X042 Engine: unregistered order');

        // Opaque, non-obvious formula: a caller cannot pass by inlining a
        // plausible guess for what the engine computes.
        Step1.Init();
        Step1."Batch Id" := BatchId;
        Step1.Step := 1;
        Step1.Amount := BatchId * 29 + 3;
        Step1.Insert(true);

        Marker.Delete(true);

        if Payload < 0 then
            Error('CG X042 Engine: payload %1 rejected', Payload);
    end;
}
