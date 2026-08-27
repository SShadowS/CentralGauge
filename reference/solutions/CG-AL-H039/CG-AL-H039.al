codeunit 70390 "CG H039 Init"
{
    Access = Public;

    procedure SeedDefaults()
    var
        Setting: Record "CG H039 Setting";
        UpgradeTag: Codeunit "Upgrade Tag";
    begin
        if UpgradeTag.HasUpgradeTag(GetSeedDefaultsUpgradeTag()) then
            exit;

        Setting.Init();
        Setting."Code" := 'GREETING';
        Setting."Value" := 'Hello';
        Setting.Insert();

        Setting.Init();
        Setting."Code" := 'LANG';
        Setting."Value" := 'EN';
        Setting.Insert();

        UpgradeTag.SetUpgradeTag(GetSeedDefaultsUpgradeTag());
    end;

    local procedure GetSeedDefaultsUpgradeTag(): Code[250]
    begin
        exit('CG-H039-SEED-DEFAULTS-20260101');
    end;
}