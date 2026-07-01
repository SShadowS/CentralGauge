codeunit 69682 "CG X008 Worker"
{
    trigger OnRun()
    var
        Input: Record "CG X008 Input";
        Signal: Record "CG X008 Signal";
        Total: Integer;
    begin
        Input.Reset();
        if Input.FindSet() then
            repeat
                Total += Input."Value";
            until Input.Next() = 0;

        if not Signal.Get('') then begin
            Signal.Init();
            Signal."Primary Key" := '';
            Signal.Insert();
        end;
        // Opaque, non-sum formula: a model cannot pass by inlining a plain
        // sum of the inputs without ever writing/committing/StartSession-ing.
        Signal.Result := Total * 3 + Input.Count();
        Signal.Done := true;
        Signal.Modify();
    end;
}
