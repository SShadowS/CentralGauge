codeunit 69261 "CG H027 Change Counter"
{
    Access = Public;
    SingleInstance = true;

    var
        ChangeCount: Integer;

    procedure Reset()
    begin
        ChangeCount := 0;
    end;

    procedure Increment()
    begin
        ChangeCount := ChangeCount + 1;
    end;

    procedure GetCount(): Integer
    begin
        exit(ChangeCount);
    end;
}
