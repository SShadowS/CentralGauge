codeunit 70560 "CG H056 Counter"
{
    Access = Public;

    var
        Count: Integer;

    procedure Bump()
    begin
        Count += 1;
    end;

    procedure GetCount(): Integer
    begin
        exit(Count);
    end;

    procedure AbsorbFrom(Source: Codeunit "CG H056 Counter")
    begin
        Count := Source.GetCount();
    end;

    procedure HandoffTo(var Target: Codeunit "CG H056 Counter")
    begin
        Target.AbsorbFrom(this);
    end;
}