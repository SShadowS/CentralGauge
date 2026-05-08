table 90001 "CG Spike Mid Trigger"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[20]) { }
        field(2; "Watched"; Integer)
        {
            trigger OnValidate()
            var
                Logger: Codeunit "CG Spike Logger";
            begin
                Logger.Log(StrSubstNo('U2-before-Modify: Rec.Watched=%1; xRec.Watched=%2', Rec.Watched, xRec.Watched));
                Rec.Modify();
                Logger.Log(StrSubstNo('U2-after-Modify:  Rec.Watched=%1; xRec.Watched=%2', Rec.Watched, xRec.Watched));
            end;
        }
        field(3; "StorageKey"; Guid)
        {
            DataClassification = SystemMetadata;
        }
    }

    keys
    {
        key(PK; "Code") { Clustered = true; }
    }

    procedure SetSecretLikeESealSetup(Value: Text)
    begin
        if IsNullGuid(Rec.StorageKey) then
            Rec.StorageKey := CreateGuid();
        IsolatedStorage.Set(Format(Rec.StorageKey), Value, DataScope::Company);
        if Value = '' then
            Clear(Rec.StorageKey);
        // Note: NO Rec.Modify() here, mimicking E-Seal Setup SetServiceCredential
    end;
}
