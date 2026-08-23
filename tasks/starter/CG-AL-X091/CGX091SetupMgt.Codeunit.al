codeunit 70561 "CG X091 Setup Mgt"
{
    var
        CachedSetup: Record "CG X091 Setup";
        CacheLoaded: Boolean;

    procedure GetSetup(var Setup: Record "CG X091 Setup")
    begin
        if not CacheLoaded then begin
            if not CachedSetup.Get() then begin
                CachedSetup.Init();
                CachedSetup.Insert();
            end;
            CacheLoaded := true;
        end;
        Setup := CachedSetup;
    end;

    procedure Invalidate()
    begin
        CacheLoaded := false;
        Clear(CachedSetup);
    end;
}
