codeunit 69871 "CG X035 Engine"
{
    trigger OnRun()
    var
        Attempt: Record "CG X035 Attempt";
    begin
        Attempt.SetRange(Processed, false);
        if not Attempt.FindSet() then
            Error('CG X035 Engine: no pending Attempt row to process');

        repeat
            if Attempt."No." < 0 then
                Error('CG X035 Engine: refused to process No. %1', Attempt."No.");

            // Opaque, non-obvious formula: a caller cannot pass by inlining a
            // plausible guess for what the engine computes.
            Attempt.Result := Attempt."No." * 9 + 4;
            Attempt.Processed := true;
            Attempt.Modify();
        until Attempt.Next() = 0;
    end;
}
