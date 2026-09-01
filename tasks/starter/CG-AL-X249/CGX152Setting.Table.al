table 71361 "CG X152 Setting"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Profile Code"; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Setting Key"; Text[100]) { DataClassification = CustomerContent; }
        field(3; "Setting Value"; Text[250]) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Profile Code", "Setting Key") { Clustered = true; }
    }
}
