codeunit 71362 "CG X152 Config Importer"
{
    procedure ImportConfig(ProfileCode: Code[20]; Config: Text)
    var
        Resolved: Dictionary of [Text, Text];
        ResolvedKey: Text;
        Entry: Text;
        KeyText: Text;
        ValueText: Text;
        SeparatorPos: Integer;
        InvalidEntryErr: Label 'Setting entry ''%1'' in profile %2 is not valid.', Comment = '%1 = the malformed entry text, %2 = profile code';
    begin
        foreach Entry in Config.Split(';') do
            if Entry.Trim() <> '' then begin
                // Cut at the FIRST '=' so a value may contain '=' itself.
                SeparatorPos := Entry.IndexOf('=');
                if SeparatorPos = 0 then
                    Error(InvalidEntryErr, Entry.Trim(), ProfileCode);
                KeyText := CopyStr(Entry, 1, SeparatorPos - 1).Trim();
                if KeyText = '' then
                    Error(InvalidEntryErr, Entry.Trim(), ProfileCode);
                ValueText := CopyStr(Entry, SeparatorPos + 1).Trim();
                Resolved.Set(KeyText, ValueText);
            end;

        foreach ResolvedKey in Resolved.Keys() do
            SaveSetting(ProfileCode, ResolvedKey, Resolved.Get(ResolvedKey));
    end;

    procedure GetSetting(ProfileCode: Code[20]; SettingKey: Text): Text
    var
        Setting: Record "CG X152 Setting";
    begin
        Setting.Get(ProfileCode, SettingKey);
        exit(Setting."Setting Value");
    end;

    procedure SettingExists(ProfileCode: Code[20]; SettingKey: Text): Boolean
    var
        Setting: Record "CG X152 Setting";
    begin
        exit(Setting.Get(ProfileCode, SettingKey));
    end;

    local procedure SaveSetting(ProfileCode: Code[20]; SettingKey: Text; SettingValue: Text)
    var
        Setting: Record "CG X152 Setting";
    begin
        if Setting.Get(ProfileCode, CopyStr(SettingKey, 1, MaxStrLen(Setting."Setting Key"))) then begin
            Setting."Setting Value" := CopyStr(SettingValue, 1, MaxStrLen(Setting."Setting Value"));
            Setting.Modify();
        end else begin
            Setting.Init();
            Setting."Profile Code" := ProfileCode;
            Setting."Setting Key" := CopyStr(SettingKey, 1, MaxStrLen(Setting."Setting Key"));
            Setting."Setting Value" := CopyStr(SettingValue, 1, MaxStrLen(Setting."Setting Value"));
            Setting.Insert();
        end;
    end;
}
