codeunit 70910 "CG X002 Migration"
{
    Access = Internal;

    trigger OnRun()
    begin
        ProcessAllInputs();
    end;

    procedure RunOnce(): Boolean
    var
        X002State: Record "CG X002 State";
    begin
        if X002State.FindFirst() then
            if X002State.Done then
                exit(true);

        Commit();
        exit(Codeunit.Run(Codeunit::"CG X002 Migration"));
    end;

    local procedure ProcessAllInputs()
    var
        X002Input: Record "CG X002 Input";
        X002Result: Record "CG X002 Result";
        X002State: Record "CG X002 State";
    begin
        X002Input.SetCurrentKey("Entry No.");
        X002Input.SetAscending("Entry No.", true);
        if X002Input.FindSet() then
            repeat
                if X002Input.Value < 0 then
                    Error('poison');

                X002Result.Init();
                X002Result."Entry No." := X002Input."Entry No.";
                X002Result.Value := X002Input.Value;
                X002Result.Insert();
            until X002Input.Next() = 0;

        if X002State.FindFirst() then begin
            X002State.Done := true;
            X002State.Modify();
        end else begin
            X002State.Init();
            X002State.Done := true;
            X002State.Insert();
        end;
    end;
}