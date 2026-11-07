table 70043 "CGR Saved Desk Selection"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Selection Code"; Code[20]) { }
        field(2; "Table No."; Integer) { }
        field(3; "View Text"; Text[2048]) { }
    }

    keys
    {
        key(PK; "Selection Code") { Clustered = true; }
    }
}
