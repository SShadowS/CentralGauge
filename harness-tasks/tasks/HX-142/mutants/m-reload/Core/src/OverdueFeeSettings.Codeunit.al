codeunit 70060 "CGR Overdue Fee Settings"
{
    SingleInstance = true;

    var
        CachedFeePerDay: Decimal;
        CachedGraceDays: Integer;
        SettingsLoaded: Boolean;

    procedure FeePerDay(): Decimal
    begin
        EnsureLoaded();
        exit(CachedFeePerDay);
    end;

    procedure GraceDays(): Integer
    begin
        EnsureLoaded();
        exit(CachedGraceDays);
    end;

    procedure Reload()
    begin
        EnsureLoaded();
    end;

    local procedure EnsureLoaded()
    begin
        if not SettingsLoaded then
            LoadSettings();
    end;

    local procedure LoadSettings()
    var
        Setup: Record "CGR Setup";
    begin
        if not Setup.Get() then
            Setup.Init();
        CachedFeePerDay := Setup."Overdue Fee per Day";
        CachedGraceDays := Setup."Overdue Grace Days";
        SettingsLoaded := true;
    end;
}
