codeunit 89372 "CG-AL-X152 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured, SOAP runner), so every test clears the table before
    // seeding its own rows.

    [Test]
    procedure ImportingUniqueSettingsSavesEveryEntry()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P1', 'retries=3;timeout=30;endpoint=https://api.example.com');

        Assert.AreEqual('3', ConfigImporter.GetSetting('P1', 'retries'), 'A plain config with no repeated setting must save every entry.');
        Assert.AreEqual('30', ConfigImporter.GetSetting('P1', 'timeout'), 'A plain config with no repeated setting must save every entry.');
        Assert.AreEqual('https://api.example.com', ConfigImporter.GetSetting('P1', 'endpoint'), 'A plain config with no repeated setting must save every entry.');
    end;

    [Test]
    procedure BlankSegmentsAreSkippedAndAnEmptyValueIsKept()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P2', ';present=set;;flag=;   ;another=data;');

        Setting.SetRange("Profile Code", 'P2');
        Assert.AreEqual(3, Setting.Count(), 'Blank and all-space segments must not produce extra saved settings.');
        Assert.AreEqual('set', ConfigImporter.GetSetting('P2', 'present'), 'A normal entry around blank segments must still save correctly.');
        Assert.IsTrue(ConfigImporter.SettingExists('P2', 'flag'), 'An entry with no value after the equals sign is still a valid setting.');
        Assert.AreEqual('', ConfigImporter.GetSetting('P2', 'flag'), 'An entry with no value after the equals sign must save as an empty value, not be dropped.');
        Assert.AreEqual('data', ConfigImporter.GetSetting('P2', 'another'), 'An entry following blank segments must still save correctly.');
    end;

    [Test]
    procedure ARepeatedSettingAtTheEndOfTheStringKeepsTheLastValue()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P3', 'code=1;code=2;code=3');

        Assert.AreEqual('3', ConfigImporter.GetSetting('P3', 'code'), 'When a setting is listed three times, the last-listed value must be the one that is saved.');
    end;

    [Test]
    procedure ARepeatedSettingKeepsItsOwnLastValueEvenWhenOtherSettingsFollowIt()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P4', 'code=1;code=2;other=9');

        Assert.AreEqual('2', ConfigImporter.GetSetting('P4', 'code'), 'The last-listed value for a repeated setting wins, regardless of where in the string its final occurrence sits relative to other settings.');
        Assert.AreEqual('9', ConfigImporter.GetSetting('P4', 'other'), 'A setting listed after a repeated one must still be saved with its own value.');
    end;

    [Test]
    procedure AnInvalidEntryLeavesThePreviouslySavedSettingsAndSkipsTheRestOfTheFile()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P5', 'keep=100;stable=200');
        Commit();

        asserterror ConfigImporter.ImportConfig('P5', 'keep=999;fresh=555;badline');

        Assert.AreEqual('100', ConfigImporter.GetSetting('P5', 'keep'), 'A file that fails partway through must leave settings from an earlier successful import untouched.');
        Assert.AreEqual('200', ConfigImporter.GetSetting('P5', 'stable'), 'A file that fails partway through must leave settings from an earlier successful import untouched.');
        Assert.IsFalse(ConfigImporter.SettingExists('P5', 'fresh'), 'None of a failed file''s settings may be saved, including ones listed before the point of failure.');
    end;

    [Test]
    procedure ImportingIntoOneProfileLeavesAnotherProfileUntouched()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P6A', 'shared=1');
        ConfigImporter.ImportConfig('P6B', 'shared=99;private=42');

        ConfigImporter.ImportConfig('P6A', 'shared=2;fresh=7');

        Assert.AreEqual('2', ConfigImporter.GetSetting('P6A', 'shared'), 'Re-importing into one profile must update that profile''s own settings.');
        Assert.AreEqual('7', ConfigImporter.GetSetting('P6A', 'fresh'), 'Re-importing into one profile must save new settings for that profile.');
        Assert.AreEqual('99', ConfigImporter.GetSetting('P6B', 'shared'), 'Importing into one profile must not change a same-named setting saved for a different profile.');
        Assert.AreEqual('42', ConfigImporter.GetSetting('P6B', 'private'), 'Importing into one profile must not touch a different profile''s other settings.');
    end;

    [Test]
    procedure GetSettingOnAMissingKeyFails()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P7', 'present=1');

        asserterror ConfigImporter.GetSetting('P7', 'absent');
    end;

    [Test]
    procedure SettingExistsReportsWhetherASettingWasSaved()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P8', 'present=1');

        Assert.IsTrue(ConfigImporter.SettingExists('P8', 'present'), 'A setting that was saved must be reported as existing.');
        Assert.IsFalse(ConfigImporter.SettingExists('P8', 'absent'), 'A setting that was never saved must be reported as not existing.');
        Assert.IsFalse(ConfigImporter.SettingExists('P8Other', 'present'), 'A setting saved for one profile must not be reported as existing under a different profile.');
    end;
}
