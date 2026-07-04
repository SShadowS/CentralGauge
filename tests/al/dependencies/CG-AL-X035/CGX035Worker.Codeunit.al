codeunit 69871 "CG X035 Worker"
{
    trigger OnRun()
    var
        Entry: Record "CG X035 Entry";
    begin
        Entry.SetRange(Processed, false);
        if not Entry.FindSet() then
            Error('CG X035 Worker: no pending Entry row to process');

        repeat
            if Entry."No." < 0 then
                Error('CG X035 Worker: refused to process No. %1', Entry."No.");

            // Opaque, non-obvious formula: a caller cannot pass by inlining a
            // plausible guess for what the worker computes.
            Entry.Result := Entry."No." * 9 + 4;
            Entry.Processed := true;
            Entry.Modify();
        until Entry.Next() = 0;
    end;
}
