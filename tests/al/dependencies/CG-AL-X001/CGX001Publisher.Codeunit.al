codeunit 69601 "CG X001 Publisher"
{
    procedure Raise()
    begin
        OnPing();
    end;

    [IntegrationEvent(false, false)]
    local procedure OnPing()
    begin
    end;
}
