codeunit 70045 "CGR Contract No. Pool"
{
    SingleInstance = true;

    var
        SequenceTok: Label 'CGR-RentalContractNo', Locked = true;

    procedure NextNo(): Code[20]
    var
        No: BigInteger;
    begin
        EnsureSequence();
        No := NumberSequence.Next(SequenceTok);
        exit(CopyStr('RC' + Format(No, 0, 9), 1, 20));
    end;

    procedure Reset()
    begin
        ClearAll();
    end;

    local procedure EnsureSequence()
    var
        Setup: Record "CGR Setup";
    begin
        if NumberSequence.Exists(SequenceTok) then
            exit;
        if not Setup.Get() then
            Clear(Setup);
        NumberSequence.Insert(SequenceTok, Setup."Last Contract No." + 1, 1);
    end;
}
