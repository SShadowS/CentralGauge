table 71392 "CG X155 Group Member"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "User Code"; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Group Code"; Code[20]) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "User Code", "Group Code") { Clustered = true; }
    }
}
