codeunit 70121 "CG JSON Config Handler"
{
    Access = Public;

    procedure ParseJsonConfig(JsonText: Text): JsonObject
    var
        JsonObj: JsonObject;
    begin
        if not JsonObj.ReadFrom(JsonText) then
            Error('Invalid JSON configuration: %1', JsonText);
        exit(JsonObj);
    end;

    procedure CreateJsonFromSettings(Settings: Dictionary of [Text, Text]): JsonObject
    var
        JsonObj: JsonObject;
        SettingKey: Text;
    begin
        foreach SettingKey in Settings.Keys() do
            JsonObj.Add(SettingKey, Settings.Get(SettingKey));
        exit(JsonObj);
    end;

    procedure MergeJsonConfigs(BaseJson: JsonObject; OverrideJson: JsonObject): JsonObject
    var
        MergedJson: JsonObject;
        JsonTok: JsonToken;
        JsonKey: Text;
    begin
        foreach JsonKey in BaseJson.Keys() do begin
            BaseJson.Get(JsonKey, JsonTok);
            MergedJson.Add(JsonKey, JsonTok);
        end;

        foreach JsonKey in OverrideJson.Keys() do begin
            OverrideJson.Get(JsonKey, JsonTok);
            if MergedJson.Contains(JsonKey) then
                MergedJson.Replace(JsonKey, JsonTok)
            else
                MergedJson.Add(JsonKey, JsonTok);
        end;

        exit(MergedJson);
    end;

    procedure GetStringValue(Json: JsonObject; JsonKey: Text): Text
    var
        JsonTok: JsonToken;
    begin
        if not Json.Get(JsonKey, JsonTok) then
            exit('');
        exit(JsonTok.AsValue().AsText());
    end;

    procedure GetIntValue(Json: JsonObject; JsonKey: Text): Integer
    var
        JsonTok: JsonToken;
    begin
        if not Json.Get(JsonKey, JsonTok) then
            exit(0);
        exit(JsonTok.AsValue().AsInteger());
    end;
}