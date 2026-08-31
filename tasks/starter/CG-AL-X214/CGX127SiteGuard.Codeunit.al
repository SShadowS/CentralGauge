codeunit 70872 "CG X127 Site Guard"
{
    procedure CheckSiteAllowed(SiteCode: Code[10])
    var
        Company: Record Company;
        SiteSetup: Record "CG X127 Site Setup";
    begin
        if SiteCode = '' then
            exit;

        if Company.FindSet() then
            repeat
                SiteSetup.ChangeCompany(Company.Name);
                if SiteSetup.Get(SiteCode) then
                    if SiteSetup.Restricted then
                        Error('Site %1 cannot be used because it is currently restricted.', SiteCode);
            until Company.Next() = 0;
    end;
}
