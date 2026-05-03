codeunit 80021 "CG-AL-M021 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        JsonHandler: Codeunit "CG JSON Config Handler";

    [Test]
    procedure TestParseJsonConfig_ValidObject()
    var
        Result: JsonObject;
        Token: JsonToken;
    begin
        Result := JsonHandler.ParseJsonConfig('{"name":"MyApp","port":8080}');

        Assert.IsTrue(Result.Get('name', Token), 'Result should contain name key');
        Assert.AreEqual('MyApp', Token.AsValue().AsText(), 'name should be MyApp');
        Assert.IsTrue(Result.Get('port', Token), 'Result should contain port key');
        Assert.AreEqual(8080, Token.AsValue().AsInteger(), 'port should be 8080');
    end;

    [Test]
    procedure TestParseJsonConfig_EmptyObject()
    var
        Result: JsonObject;
    begin
        Result := JsonHandler.ParseJsonConfig('{}');

        Assert.AreEqual(0, Result.Keys().Count(), 'Empty JSON should produce zero-key object');
    end;

    [Test]
    procedure TestCreateJsonFromSettings_BuildsObject()
    var
        Settings: Dictionary of [Text, Text];
        Result: JsonObject;
        Token: JsonToken;
    begin
        Settings.Add('name', 'BCExtension');
        Settings.Add('version', '1.0.0');
        Settings.Add('environment', 'production');

        Result := JsonHandler.CreateJsonFromSettings(Settings);

        Assert.IsTrue(Result.Get('name', Token), 'Result should contain name key');
        Assert.AreEqual('BCExtension', Token.AsValue().AsText(), 'name value should match');
        Assert.IsTrue(Result.Get('version', Token), 'Result should contain version key');
        Assert.AreEqual('1.0.0', Token.AsValue().AsText(), 'version value should match');
        Assert.IsTrue(Result.Get('environment', Token), 'Result should contain environment key');
        Assert.AreEqual('production', Token.AsValue().AsText(), 'environment value should match');
    end;

    [Test]
    procedure TestCreateJsonFromSettings_EmptyDictionary()
    var
        Settings: Dictionary of [Text, Text];
        Result: JsonObject;
    begin
        Result := JsonHandler.CreateJsonFromSettings(Settings);

        Assert.AreEqual(0, Result.Keys().Count(), 'Empty dictionary should produce empty JsonObject');
    end;

    [Test]
    procedure TestMergeJsonConfigs_OverrideWins()
    var
        BaseJson: JsonObject;
        OverrideJson: JsonObject;
        Result: JsonObject;
        Token: JsonToken;
    begin
        BaseJson.Add('name', 'BaseApp');
        BaseJson.Add('version', '1.0.0');
        BaseJson.Add('debug', 'false');
        OverrideJson.Add('debug', 'true');

        Result := JsonHandler.MergeJsonConfigs(BaseJson, OverrideJson);

        Assert.IsTrue(Result.Get('name', Token), 'Merged result should keep base name');
        Assert.AreEqual('BaseApp', Token.AsValue().AsText(), 'name should remain BaseApp');
        Assert.IsTrue(Result.Get('version', Token), 'Merged result should keep base version');
        Assert.AreEqual('1.0.0', Token.AsValue().AsText(), 'version should remain 1.0.0');
        Assert.IsTrue(Result.Get('debug', Token), 'Merged result should contain debug');
        Assert.AreEqual('true', Token.AsValue().AsText(), 'debug should be overridden to true');
    end;

    [Test]
    procedure TestMergeJsonConfigs_AddsNewKey()
    var
        BaseJson: JsonObject;
        OverrideJson: JsonObject;
        Result: JsonObject;
        Token: JsonToken;
    begin
        BaseJson.Add('name', 'App');
        BaseJson.Add('version', '2.0');
        OverrideJson.Add('newFeature', 'enabled');

        Result := JsonHandler.MergeJsonConfigs(BaseJson, OverrideJson);

        Assert.IsTrue(Result.Get('name', Token), 'Should keep base name key');
        Assert.AreEqual('App', Token.AsValue().AsText(), 'name should remain App');
        Assert.IsTrue(Result.Get('version', Token), 'Should keep base version key');
        Assert.IsTrue(Result.Get('newFeature', Token), 'Should add newFeature from override');
        Assert.AreEqual('enabled', Token.AsValue().AsText(), 'newFeature should be enabled');
    end;

    [Test]
    procedure TestMergeJsonConfigs_EmptyOverride()
    var
        BaseJson: JsonObject;
        OverrideJson: JsonObject;
        Result: JsonObject;
        Token: JsonToken;
    begin
        BaseJson.Add('key1', 'value1');
        BaseJson.Add('key2', 'value2');

        Result := JsonHandler.MergeJsonConfigs(BaseJson, OverrideJson);

        Assert.IsTrue(Result.Get('key1', Token), 'Should keep key1');
        Assert.AreEqual('value1', Token.AsValue().AsText(), 'value1 should be preserved');
        Assert.IsTrue(Result.Get('key2', Token), 'Should keep key2');
        Assert.AreEqual('value2', Token.AsValue().AsText(), 'value2 should be preserved');
    end;

    [Test]
    procedure TestGetStringValue_ExistingKey()
    var
        Json: JsonObject;
        Result: Text;
    begin
        Json.Add('environment', 'production');

        Result := JsonHandler.GetStringValue(Json, 'environment');

        Assert.AreEqual('production', Result, 'Should return value for existing key');
    end;

    [Test]
    procedure TestGetStringValue_MissingKey()
    var
        Json: JsonObject;
        Result: Text;
    begin
        Json.Add('name', 'Demo');

        Result := JsonHandler.GetStringValue(Json, 'missing');

        Assert.AreEqual('', Result, 'Should return empty string for missing key');
    end;

    [Test]
    procedure TestGetIntValue_ExistingKey()
    var
        Json: JsonObject;
        Result: Integer;
    begin
        Json.Add('port', 8080);

        Result := JsonHandler.GetIntValue(Json, 'port');

        Assert.AreEqual(8080, Result, 'Should return integer value for existing key');
    end;

    [Test]
    procedure TestGetIntValue_MissingKey()
    var
        Json: JsonObject;
        Result: Integer;
    begin
        Json.Add('port', 8080);

        Result := JsonHandler.GetIntValue(Json, 'absent');

        Assert.AreEqual(0, Result, 'Should return 0 for missing key');
    end;
}
