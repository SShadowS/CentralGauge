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
        Signal.Result := Total;
        Signal.Done := true;
        Signal.Modify();
    end;
}
