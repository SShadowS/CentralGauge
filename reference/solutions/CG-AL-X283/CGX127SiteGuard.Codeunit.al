codeunit 70872 "CG X127 Site Guard"
{
    procedure CheckSiteAllowed(SiteCode: Code[10])
    var
        SiteSetup: Record "CG X127 Site Setup";
    begin
        if SiteCode = '' then
            exit;

        if SiteSetup.Get(SiteCode) then
            if SiteSetup.Restricted then
                Error('Site %1 cannot be used because it is currently restricted.', SiteCode);
    end;
}
