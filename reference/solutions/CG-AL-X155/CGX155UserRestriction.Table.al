table 71391 "CG X155 User Restriction"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "User Code"; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Area Code"; Code[20]) { DataClassification = CustomerContent; }
        field(3; "Restriction Level"; Enum "CG X155 Restriction Level") { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "User Code", "Area Code") { Clustered = true; }
    }
}
