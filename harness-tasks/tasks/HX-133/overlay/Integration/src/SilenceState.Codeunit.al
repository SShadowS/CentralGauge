codeunit 70405 "CGR Silence State"
{
    SingleInstance = true;

    var
        IsSilencedNow: Boolean;

    procedure SetSilenced(NewValue: Boolean)
    begin
        IsSilencedNow := NewValue;
    end;

    procedure SilencedNow(): Boolean
    begin
        exit(IsSilencedNow);
    end;
}
