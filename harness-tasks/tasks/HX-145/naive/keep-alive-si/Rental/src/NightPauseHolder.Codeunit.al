codeunit 70297 "CGR Night Pause Holder"
{
    SingleInstance = true;

    var
        Pause: Codeunit "CGR Notify Pause";

    procedure BeginNightPause()
    begin
        BindSubscription(Pause);
    end;

    procedure EndNightPause()
    begin
        UnbindSubscription(Pause);
    end;
}
