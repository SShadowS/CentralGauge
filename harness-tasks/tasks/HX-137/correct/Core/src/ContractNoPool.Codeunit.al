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
        // The block is reserved inside the caller's transaction. When that transaction is rolled back,
        // the setup row returns to the old counter but this single-instance state does not: drop the block.
        if BlockEnd <> 0 then begin
            if not Setup.Get() then
                Clear(Setup);
            if Setup."Last Contract No." < BlockEnd then
                BlockEnd := 0;
        end;
        if (BlockEnd = 0) or (NextInBlock > BlockEnd) then begin
            Setup.LockTable();
            Setup.GetOrCreate();
            NextInBlock := Setup."Last Contract No." + 1;
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
