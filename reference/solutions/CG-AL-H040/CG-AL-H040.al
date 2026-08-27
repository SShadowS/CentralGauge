codeunit 70400 "CG H040 Tag Provider"
{
    Access = Public;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"Upgrade Tag", 'OnGetPerCompanyUpgradeTags', '', false, false)]
    local procedure OnGetPerCompanyUpgradeTags(var PerCompanyUpgradeTags: List of [Code[250]])
    begin
        PerCompanyUpgradeTags.Add(GetFeatureXUpgradeTag());
    end;

    local procedure GetFeatureXUpgradeTag(): Code[250]
    begin
        exit('CG-H040-FEATURE-X-20260101');
    end;
}