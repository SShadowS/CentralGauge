table 71393 "CG X155 Group Restriction"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Group Code"; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Area Code"; Code[20]) { DataClassification = CustomerContent; }
        field(3; "Restriction Level"; Enum "CG X155 Restriction Level") { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Group Code", "Area Code") { Clustered = true; }
    }
}
