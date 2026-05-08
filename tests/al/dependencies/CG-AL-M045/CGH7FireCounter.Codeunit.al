codeunit 69271 "CG M045 Fire Counter"
{
    Access = Public;
    SingleInstance = true;

    var
        FireCount: Integer;

    procedure Reset()
    begin
        FireCount := 0;
    end;

    procedure Increment()
    begin
        FireCount := FireCount + 1;
    end;

    procedure GetCount(): Integer
    begin
        exit(FireCount);
    end;
}
