codeunit 80255 "CG-AL-H040 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestPerCompanyTagIsRegistered()
    var
        UpgradeTag: Codeunit "Upgrade Tag";
        PerCompanyTags: List of [Code[250]];
    begin
        // [SCENARIO] The test calls Codeunit "Upgrade Tag".GetPerCompanyUpgradeTags,
        // which raises OnGetPerCompanyUpgradeTags. The model's app must contribute
        // the tag literal 'CG-H040-FEATURE-X-20260101' through that event subscriber.
        UpgradeTag.GetPerCompanyUpgradeTags(PerCompanyTags);

        Assert.IsTrue(
            PerCompanyTags.Contains('CG-H040-FEATURE-X-20260101'),
            'List returned by Codeunit "Upgrade Tag".GetPerCompanyUpgradeTags must contain ''CG-H040-FEATURE-X-20260101''.');
    end;

    [Test]
    procedure TestPerDatabaseTagIsNotRegistered()
    var
        UpgradeTag: Codeunit "Upgrade Tag";
        PerDatabaseTags: List of [Code[250]];
    begin
        // The tag is per-company; the model must NOT register it on OnGetPerDatabaseUpgradeTags.
        UpgradeTag.GetPerDatabaseUpgradeTags(PerDatabaseTags);

        Assert.IsFalse(
            PerDatabaseTags.Contains('CG-H040-FEATURE-X-20260101'),
            'Per-database tag list must NOT contain ''CG-H040-FEATURE-X-20260101''; the tag is per-company only.');
    end;
}
