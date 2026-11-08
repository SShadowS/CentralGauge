codeunit 70045 "CGR Contract No. Pool"
{
    SingleInstance = true;

    var
        NextInBlock: Integer;
        BlockEnd: Integer;

    procedure NextNo(): Code[20]
    var
        Setup: Record "CGR Setup";
        No: Integer;
    begin
        if (BlockEnd = 0) or (NextInBlock > BlockEnd) then begin
            Setup.LockTable();
            Setup.GetOrCreate();
            NextInBlock := Setup."Last Contract No.";
            Setup."Last Contract No." += 10;
            BlockEnd := Setup."Last Contract No.";
            Setup.Modify();
        end;
        No := NextInBlock;
        NextInBlock += 1;
        exit(CopyStr('RC' + Format(No, 0, 9), 1, 20));
    end;

    procedure Reset()
    begin
        ClearAll();
    end;
}
