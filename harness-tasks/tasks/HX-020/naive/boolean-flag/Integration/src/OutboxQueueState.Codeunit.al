codeunit 70411 "CGR Outbox Queue State"
{
    SingleInstance = true;
    Access = Internal;

    var
        Suspended: Boolean;

    procedure SetSuspended(NewSuspended: Boolean)
    begin
        Suspended := NewSuspended;
    end;

    procedure IsSuspended(): Boolean
    begin
        exit(Suspended);
    end;
}
