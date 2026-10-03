codeunit 70411 "CGR Outbox Queue State"
{
    SingleInstance = true;
    Access = Internal;

    var
        SuspensionCount: Integer;

    procedure AddSuspension()
    begin
        SuspensionCount += 1;
    end;

    procedure RemoveSuspension()
    begin
        if SuspensionCount > 0 then
            SuspensionCount -= 1;
    end;

    procedure HasSuspension(): Boolean
    begin
        exit(SuspensionCount > 0);
    end;
}
