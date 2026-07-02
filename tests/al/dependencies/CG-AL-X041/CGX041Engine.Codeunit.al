codeunit 69931 "CG X041 Engine"
{
    trigger OnRun()
    var
        Marker: Record "CG X041 Doc";
        Line1: Record "CG X041 Doc";
        Line2: Record "CG X041 Doc";
        Payload: Integer;
        BatchId: Integer;
    begin
        Marker.SetRange("Line No.", 0);
        if not Marker.FindFirst() then
            Error('CG X041 Engine: no pending batch');

        // The caller stashes its input value in the pending marker row's
        // Amount field; capture it before the marker is replaced.
        BatchId := Marker."Batch Id";
        Payload := Marker.Amount;

        // Line 1: durable write, posted and committed BEFORE the designed
        // failure check below. A caller that later sees this run return
        // false must NOT assume this line was rolled back with it.
        Line1.Init();
        Line1."Batch Id" := BatchId;
        Line1."Line No." := 1;
        // Opaque, non-obvious formula: a caller cannot pass by inlining a
        // plausible guess for what the engine computes.
        Line1.Amount := BatchId * 19 + 4;
        Line1.Status := Line1.Status::Posted;
        Line1.Insert();
        Commit();

        // Line 2: written AFTER the commit above, so it rolls back with the
        // engine's own error below — but Line 1 does NOT.
        Line2.Init();
        Line2."Batch Id" := BatchId;
        Line2."Line No." := 2;
        Line2.Amount := BatchId * 23 + 1;
        Line2.Status := Line2.Status::Open;
        Line2.Insert();

        Marker.Delete();

        if Payload < 0 then
            Error('CG X041 Engine: payload %1 rejected', Payload);
    end;
}
